import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const installSh = fs.readFileSync(path.resolve(__dirname, '../../helpers/install.sh'), 'utf-8');
const installBat = fs.readFileSync(path.resolve(__dirname, '../../helpers/install.bat'), 'utf-8');
const installPy = fs.readFileSync(path.resolve(__dirname, '../../helpers/install.py'), 'utf-8');
const nativeHostPy = fs.readFileSync(path.resolve(__dirname, '../../helpers/native_host.py'), 'utf-8');
const manifestJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../extension/manifest.json'), 'utf-8'));

describe('Native Messaging Host & Installer Suite', () => {
  it('should match extension ID in manifest.json with allowed_extensions in install scripts', () => {
    const extensionId = manifestJson.browser_specific_settings.gecko.id;
    expect(extensionId).toBe('torbox-streamer@flamprakis.com');

    expect(installSh).toContain(extensionId);
    expect(installBat).toContain(extensionId);
    expect(installPy).toContain(extensionId);
  });

  it('should not contain Chrome-only "allowed_origins": key in Firefox manifest templates', () => {
    expect(installSh).not.toContain('"allowed_origins":');
    expect(installBat).not.toContain('"allowed_origins":');
    expect(installPy).not.toContain('"allowed_origins":');
  });

  it('should support MPV and VLC player actions in native_host.py', () => {
    expect(nativeHostPy).toContain('launch_mpv');
    expect(nativeHostPy).toContain('launch_vlc');
    expect(nativeHostPy).toContain('struct.unpack');
    expect(nativeHostPy).toContain('struct.pack');
  });
});
