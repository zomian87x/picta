# macOS Code Signing and Notarization

This project is configured to sign and notarize public macOS releases with `electron-builder`.

## Required Apple assets

1. A `Developer ID Application` certificate exported as `.p12`
2. The password for that `.p12`
3. An App Store Connect API key (`.p8`)
4. The App Store Connect API key ID
5. The App Store Connect issuer ID

## Local build

Set these environment variables before running `npm run build`:

```bash
export CSC_LINK=/absolute/path/to/DeveloperIDApplication.p12
export CSC_KEY_PASSWORD='your-p12-password'
export APPLE_API_KEY=/absolute/path/to/AuthKey_ABC123XYZ.p8
export APPLE_API_KEY_ID='ABC123XYZ'
export APPLE_API_ISSUER='00000000-0000-0000-0000-000000000000'
npm run build
```

For a release build that must fail when code signing is unavailable:

```bash
npm run build:mac:release
```

Notes:

- `CSC_LINK` may be a file path or a base64/data URL supported by `electron-builder`
- `APPLE_API_KEY` must point to the `.p8` file on disk
- When these variables are missing, `electron-builder` falls back to ad-hoc signing and skips notarization

## GitHub Actions secrets

Create these repository secrets:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

For GitHub Actions in this repository:

- `APPLE_API_KEY` should contain the raw `.p8` file contents
- `CSC_LINK` can contain the certificate as a base64/data URL or another value accepted by `electron-builder`

The workflow file is:

- `.github/workflows/release-macos.yml`

## Output verification

After a successful signed build, verify the app bundle and notarization ticket locally:

```bash
codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Picta.app"
spctl --assess --type execute --verbose=4 "dist/mac-arm64/Picta.app"
xcrun stapler validate "dist/Picta-1.0.0-arm64.dmg"
```

If you later switch to universal builds, update the paths above to match the produced artifact names.
