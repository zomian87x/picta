'use strict';

const MODEL_ALIASES = {
  'nano banana': { model: 'gemini-3-pro-image-preview', thinkingLevel: null },
  'nanobanana 2': { model: 'gemini-3.1-flash-image-preview', thinkingLevel: 'MINIMAL' },
  'nano banana pro': { model: 'gemini-3-pro-image-preview', thinkingLevel: 'MEDIUM' },
};

const ASPECT_RATIOS = {
  '1:1': '1:1', '2:3': '2:3', '3:2': '3:2',
  '4:3': '4:3', '3:4': '3:4', '16:9': '16:9', '9:16': '9:16',
};

function resolveModel(aliasName, aliases) {
  const models = aliases || MODEL_ALIASES;
  return models[aliasName] || models['nanobanana 2'] || Object.values(models)[0];
}

function extractImage(response) {
  try {
    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      return { image: null, text: 'No response from model' };
    }
    const parts = candidates[0].content.parts;
    let imageData = null;
    let textData = '';
    for (const part of parts) {
      if (part.inlineData) {
        imageData = { base64: part.inlineData.data, mimeType: part.inlineData.mimeType };
      }
      if (part.text) {
        textData += part.text;
      }
    }
    return { image: imageData, text: textData };
  } catch (e) {
    return { image: null, text: `Error extracting image: ${e.message}` };
  }
}

module.exports = { MODEL_ALIASES, ASPECT_RATIOS, resolveModel, extractImage };
