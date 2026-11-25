/* The license table in DynamoDB: the store license-core.mjs asks for.
 * One table, one string key "pk":
 *
 *   LICENSE#<key>          the license: status, validUntil, the
 *                          subscription and customer, lastEventAt, and
 *                          machineCount (distinct devices that exported
 *                          with it); a "pending" one (checkout started,
 *                          not paid) has expiresAt, so TTL drops it
 *   SUB#<subscription id>  → licenseKey (finds a license from a Stripe
 *                          event)
 *   USE#<key>#<device>     firstSeen, lastSeen, exports: one per device
 *                          that exported with a license — the audit trail
 *                          for a key shared across machines
 *   FREE#<device>          count: the device's free exports, in all
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const isConditionFailure = (error) =>
  error?.name === "ConditionalCheckFailedException" ||
  (error?.name === "TransactionCanceledException" &&
    error.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed"));

export function createStore(TableName, client = new DynamoDBClient({})) {
  const db = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const get = async (pk) =>
    (await db.send(new GetCommand({ TableName, Key: { pk } }))).Item ?? null;

  return {
    async getLicense(key) {
      const item = await get(`LICENSE#${key}`);
      return item && { ...item, pk: undefined };
    },

    async keyForSubscription(subscriptionId) {
      return (await get(`SUB#${subscriptionId}`))?.licenseKey ?? null;
    },

    /* Both items or neither, and only if the subscription has no license
     * yet — the webhook and the claim can race to make it. */
    async createLicense(item) {
      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName,
                  Item: { pk: `SUB#${item.subscriptionId}`, licenseKey: item.licenseKey },
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              { Put: { TableName, Item: { pk: `LICENSE#${item.licenseKey}`, ...item } } },
            ],
          }),
        );
        return item.licenseKey;
      } catch (error) {
        if (!isConditionFailure(error)) throw error;
        return (await get(`SUB#${item.subscriptionId}`)).licenseKey;
      }
    },

    async createPendingLicense(item) {
      await db.send(
        new PutCommand({
          TableName,
          Item: { pk: `LICENSE#${item.licenseKey}`, ...item },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
    },

    /* The pending license and its subscription, linked both ways in one
     * step; it stops expiring. The webhook and the thank-you page can
     * race to do this — the second finds the first's link. */
    async attachSubscription(key, subscriptionId) {
      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName,
                  Item: { pk: `SUB#${subscriptionId}`, licenseKey: key },
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Update: {
                  TableName,
                  Key: { pk: `LICENSE#${key}` },
                  UpdateExpression: "SET subscriptionId = :s REMOVE expiresAt",
                  ConditionExpression:
                    "attribute_exists(pk) AND attribute_not_exists(subscriptionId)",
                  ExpressionAttributeValues: { ":s": subscriptionId },
                },
              },
            ],
          }),
        );
        return key;
      } catch (error) {
        if (!isConditionFailure(error)) throw error;
        return (await get(`SUB#${subscriptionId}`))?.licenseKey ?? null;
      }
    },

    async updateLicense(key, fields, eventAt) {
      const names = {};
      const values = { ":t": eventAt };
      const sets = ["lastEventAt = :t"];
      for (const [i, [field, value]] of Object.entries(fields).entries()) {
        names[`#f${i}`] = field;
        values[`:v${i}`] = value;
        sets.push(`#f${i} = :v${i}`);
      }
      try {
        await db.send(
          new UpdateCommand({
            TableName,
            Key: { pk: `LICENSE#${key}` },
            UpdateExpression: `SET ${sets.join(", ")}`,
            ConditionExpression:
              "attribute_exists(pk) AND (attribute_not_exists(lastEventAt) OR lastEventAt <= :t)",
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          }),
        );
      } catch (error) {
        // A newer event already applied: this one is stale.
        if (!isConditionFailure(error)) throw error;
      }
    },

    /* One update for the device's row; when it's the device's first
     * licensed export, the license's machineCount goes up too. */
    async recordUse(key, deviceId, now, { ci = false } = {}) {
      const { Attributes } = await db.send(
        new UpdateCommand({
          TableName,
          Key: { pk: `USE#${key}#${deviceId}` },
          // ci marks a repository's CI runs, whose device is the repository.
          UpdateExpression:
            "SET firstSeen = if_not_exists(firstSeen, :now), lastSeen = :now" +
            (ci ? ", ci = :ci" : "") +
            " ADD exports :one",
          ExpressionAttributeValues: { ":now": now, ":one": 1, ...(ci && { ":ci": true }) },
          ReturnValues: "UPDATED_OLD",
        }),
      );
      if (Attributes?.exports) return { newDevice: false, devices: null };
      const counted = await db.send(
        new UpdateCommand({
          TableName,
          Key: { pk: `LICENSE#${key}` },
          UpdateExpression: "ADD machineCount :one",
          ExpressionAttributeValues: { ":one": 1 },
          ReturnValues: "UPDATED_NEW",
        }),
      );
      return { newDevice: true, devices: counted.Attributes.machineCount };
    },

    async freeExportsUsed(deviceId) {
      return (await get(`FREE#${deviceId}`))?.count ?? 0;
    },

    /* One atomic step: add one unless the count has reached the limit. */
    async countFreeExport(deviceId, limit) {
      try {
        const { Attributes } = await db.send(
          new UpdateCommand({
            TableName,
            Key: { pk: `FREE#${deviceId}` },
            UpdateExpression: "ADD #c :one",
            ConditionExpression: "attribute_not_exists(#c) OR #c < :limit",
            ExpressionAttributeNames: { "#c": "count" },
            ExpressionAttributeValues: { ":one": 1, ":limit": limit },
            ReturnValues: "UPDATED_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );
        return { allowed: true, used: Attributes.count };
      } catch (error) {
        if (!isConditionFailure(error)) throw error;
        return { allowed: false, used: Number(error.Item?.count?.N ?? limit) };
      }
    },
  };
}
