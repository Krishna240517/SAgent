import assert from "node:assert/strict";
import test from "node:test";
import { requireToolPermission } from "../dist/edit/policy.js";

test("coding tools allow reads and sandbox checks, require edit approval, and deny host capabilities", () => {
  requireToolPermission("read");
  requireToolPermission("sandbox_test");
  assert.throws(() => requireToolPermission("patch"), /not approved/);
  requireToolPermission("patch", true);
  for (const intent of ["host_shell", "network", "credential", "delete", "publish", "remote_write"]) {
    assert.throws(() => requireToolPermission(intent, true), /No trusted/);
  }
});
