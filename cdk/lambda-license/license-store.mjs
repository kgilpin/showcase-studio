/* The license table in DynamoDB: the store license-core.mjs asks for.
 * One table, one string key "pk", three kinds of item:
 *
 *   LICENSE#<key>               the license: status, validUntil, the
 *                               subscription and customer, lastEventAt,
 *                               devices { <device id>: { name, addedAt } };
 *                               a "pending" one (checkout started, not
 *                               paid) has expiresAt, so TTL drops it
 *   SUB#<subscription id>       → licenseKey (finds a license from a
 *                               Stripe event)
 *   EXPORTS#<device>#<YYYY-MM>  count; expiresAt drops it after ~3 months
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

    /* Adds the device unless the license already has `limit` of them; a
     * device already on it stays as it was. */
    async addDevice(key, deviceId, entry, limit) {
      try {
        await db.send(
          new UpdateCommand({
            TableName,
            Key: { pk: `LICENSE#${key}` },
            UpdateExpression: "SET devices.#d = if_not_exists(devices.#d, :entry)",
            ConditionExpression:
              "attribute_exists(pk) AND (attribute_exists(devices.#d) OR size(devices) < :limit)",
            ExpressionAttributeNames: { "#d": deviceId },
            ExpressionAttributeValues: { ":entry": entry, ":limit": limit },
          }),
        );
        return true;
      } catch (error) {
        if (!isConditionFailure(error)) throw error;
        return false;
      }
    },

    async removeDevice(key, deviceId) {
      await db.send(
        new UpdateCommand({
          TableName,
          Key: { pk: `LICENSE#${key}` },
          UpdateExpression: "REMOVE devices.#d",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeNames: { "#d": deviceId },
        }),
      );
    },

    async exportsThisMonth(deviceId, month) {
      return (await get(`EXPORTS#${deviceId}#${month}`))?.count ?? 0;
    },

    /* One atomic step: add one unless the count has reached the limit. */
    async countExport(deviceId, month, limit) {
      const expiresAt = Math.floor(Date.parse(`${month}-01T00:00:00Z`) / 1000) + 100 * 24 * 3600;
      try {
        const { Attributes } = await db.send(
          new UpdateCommand({
            TableName,
            Key: { pk: `EXPORTS#${deviceId}#${month}` },
            UpdateExpression: "ADD #c :one SET expiresAt = :exp",
            ConditionExpression: "attribute_not_exists(#c) OR #c < :limit",
            ExpressionAttributeNames: { "#c": "count" },
            ExpressionAttributeValues: { ":one": 1, ":limit": limit, ":exp": expiresAt },
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
