import { test } from "node:test";
import assert from "node:assert/strict";
import { uid } from "./uid.js";

test("uid is unique and increasing even within the same millisecond", () => {
  const ids = Array.from({ length: 5000 }, () => uid()); // far faster than 1ms apart
  assert.equal(new Set(ids).size, ids.length, "all ids distinct");
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i] > ids[i - 1], "ids strictly increase");
  assert.ok(Number.isSafeInteger(ids[ids.length - 1]), "stays a safe integer");
});
