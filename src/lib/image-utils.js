'use strict';

function computeResizeDimensions(width, height, maxLongEdge) {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return { newW: width, newH: height, needsResize: false };
  }
  const scale = maxLongEdge / longEdge;
  return {
    newW: Math.round(width * scale),
    newH: Math.round(height * scale),
    needsResize: true,
  };
}

module.exports = { computeResizeDimensions };
