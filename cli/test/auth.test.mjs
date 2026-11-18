import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("device token uses the local snake-case file and nullable expiry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sagent-token-"));
  try {
    const code = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { TOKEN_FILE, storeToken, getStoredToken, isTokenExpired } from './dist/commands/auth/token.js';
      await storeToken({ access_token: 'test-token', expires_in: 3600 });
      let file = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      assert.ok(file.expires_at && file.created_at);
      assert.equal(file.expiresAt, undefined);
      assert.equal((await getStoredToken()).access_token, 'test-token');
      await storeToken({ access_token: 'test-token', expires_at: null });
      assert.equal(await isTokenExpired(), false);
      if (process.platform !== 'win32') assert.equal(fs.statSync(TOKEN_FILE).mode & 0o777, 0o600);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: { ...process.env, HOME: root, USERPROFILE: root },
      encoding: "utf8", timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(root, ".sagent", "token.json")));
  } finally {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  }
});
