# Picta - Gemini Image Generation Desktop App

[日本語版はこちら](README.md)

An Electron-based desktop application for generating and editing images using Google's Gemini image models. Supports Japanese prompts and multiple image inputs.

## Features

- **Two Modes**:
  - **Image Generation**: Generate images from text prompts
  - **Image Editing**: Edit input images based on prompts
- **Multiple Image Input Slots**: Numbered slots plus a canvas (PNG/JPG)
- **Output Controls**: Aspect ratios 1:1, 2:3, 3:2, 4:3, 3:4, 16:9, 9:16 / Resolutions 1K/2K/4K
- **Hand-drawn Canvas**: Freehand drawing tool
- **Smart Image Selection**: Choose which images to include (max 3 per generation)
- **Model Switching**: `nano banana`, `nanobanana 2`, `nano banana pro`
- **Generation History**: Track recent generations with metadata
- **Prompt Presets**: Save and manage frequently used prompts
- **Auto-Update**: Check and apply updates from within the app

## Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd picta
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run the App

```bash
npm start
```

### 4. Set up API Key

On first launch, open Settings (⌘, / Ctrl+,) and enter your Gemini API key.
The key is encrypted and stored only when OS secure storage is available (macOS Keychain / Windows Credential Manager).
If secure storage is unavailable, the app refuses to save the API key.

Get your API key from: https://ai.google.dev/

## Build

```bash
# macOS
npm run build

# Windows
npm run build:win

# All platforms
npm run build:all
```

For public macOS release signing and notarization, see [docs/macos-signing-notarization.md](docs/macos-signing-notarization.md).
The GitHub Actions workflow for automated macOS releases is [`.github/workflows/release-macos.yml`](.github/workflows/release-macos.yml).

## Installation (macOS)

The app is currently distributed without code signing. Before launching for the first time, run the following in Terminal:

```bash
sudo xattr -cr /Applications/Picta.app
sudo codesign --force --deep --sign - /Applications/Picta.app
```

## Requirements

- Node.js 18+
- Gemini API key
- Internet connection

## Model Aliases

| Alias | Model | Notes |
|---|---|---|
| `nano banana` | `gemini-3-pro-image-preview` | - |
| `nanobanana 2` | `gemini-3.1-flash-image-preview` | thinking: MINIMAL |
| `nano banana pro` | `gemini-3-pro-image-preview` | - |

## Notes

- Generated images are watermarked with SynthID
- Maximum 3 images can be processed at once (Google's recommendation)
- Only upload images you have rights to use

## Security

- API keys are not accessible from the renderer process (main process only)
- API keys are stored only when OS secure storage is available, and saving is refused otherwise
- File saving is restricted to dialog-approved paths only
- External URLs are limited to the `https:` protocol
