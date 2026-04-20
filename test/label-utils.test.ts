import assert from "node:assert/strict"
import test from "node:test"

import { chooseExecutionLabel } from "@/lib/label-utils"

test("label: preserves manual label and does not overwrite it with skill-version label", () => {
  const label = chooseExecutionLabel({
    existingLabel: "My Custom Label",
    incomingLabel: undefined,
    skill: "vmcore-analysis",
    skillVersion: 3,
  })
  assert.equal(label, "My Custom Label")
})

test("label: uses incoming label when provided", () => {
  const label = chooseExecutionLabel({
    existingLabel: "Old",
    incomingLabel: "New Label",
    skill: "vmcore-analysis",
    skillVersion: 3,
  })
  assert.equal(label, "New Label")
})

test("label: auto-generates when existing label is auto and no incoming label", () => {
  const label = chooseExecutionLabel({
    existingLabel: "vmcore-analysis-v1",
    incomingLabel: undefined,
    skill: "vmcore-analysis",
    skillVersion: 3,
  })
  assert.equal(label, "vmcore-analysis-v3")
})

