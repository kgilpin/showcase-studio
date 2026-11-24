/* Run by faces.mjs as `osascript -l JavaScript faces.jxa.js <picture>`.
 * JavaScript for Automation, not Node: ObjC, $ and Ref are osascript's.
 * Prints {faces: [{left, top, width, height, confidence}]} as fractions
 * of the picture from its top-left corner, or {error}. */
/* global ObjC, $, Ref */
ObjC.import("Foundation");
ObjC.import("Vision");
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $());
  const request = $.VNDetectFaceRectanglesRequest.alloc.init;
  const error = Ref();
  if (!handler.performRequestsError($([request]), error)) {
    return JSON.stringify({ error: "Vision could not read the picture" });
  }
  const results = request.results;
  const faces = [];
  for (let i = 0; i < results.count; i++) {
    const face = results.objectAtIndex(i);
    const box = face.boundingBox;
    faces.push({
      left: box.origin.x,
      top: 1 - box.origin.y - box.size.height,
      width: box.size.width,
      height: box.size.height,
      confidence: face.confidence,
    });
  }
  return JSON.stringify({ faces });
}
