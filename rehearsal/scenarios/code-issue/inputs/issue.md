# CSV import: row count is off (Tallybook 2.3, issue 318)

I imported October's bank export and the totals didn't match the statement. The file has 1,241 transactions and the import reported "1,240 imported", with no error. The one that's gone is the last in the file, a $412.50 rent refund.

I can make it happen every time:

1. Save a CSV whose last line has no newline after it. Our bank's export is like that.
2. Run `tallybook import october.csv`.
3. It prints `1,240 imported`. `tallybook list --last 1` shows the transaction before the refund.

If I open the file and press Return at the end, all 1,241 come in.

## Notes from a maintainer

`readRows` in `src/import/reader.js` pushes a row only when it meets a newline:

```js
for await (const chunk of file) {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    rows.push(parseRow(buffer.slice(0, end)));
    buffer = buffer.slice(end + 1);
  }
}
return rows; // whatever is left in buffer is never parsed
```

The row-flush loop never flushes. The existing tests all use fixture files that end in a newline, so they pass.

A fix has to parse what is left in the buffer at the end, not add an empty row for files that do end in a newline, and add a fixture without one.
