import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { digestProjection } from "../../src/protocol/canonical.js";
import { projectContent, projectState } from "../../src/protocol/projections.js";
import { SchemaRegistry } from "../../src/protocol/schema-registry.js";
import type { DossierSnapshot, HandoffEnvelope, MutationPrecondition } from "../../src/protocol/types.js";
import { controlledAtomicFs } from "../helpers/fault-port.js";
import { nodePathInspection } from "../../src/storage/paths.js";
import { CaseStore } from "../../src/storage/store.js";
import {
  createDossier,
  showDossier,
  type DossierDirectoryPublicationPort,
  type WorkflowPorts,
} from "../../src/workflows/dossier.js";
import { addEvidence, type AddEvidenceRequest } from "../../src/workflows/evidence.js";
import {
  acceptHandoff,
  offerHandoff,
  type AcceptHandoffRequest,
  type OfferHandoffRequest,
} from "../../src/workflows/handoff.js";

const timestamp = "2026-09-04T03:02:01Z";

async function fixture(t: TestContext): Promise<{ root: string; ports: WorkflowPorts; snapshot: DossierSnapshot }> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-handoff-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".case-agent", "dossiers"), { recursive: true });
  await mkdir(join(root, ".case-agent", "locks"), { recursive: true });
  const schemas = await SchemaRegistry.load(join(process.cwd(), "schemas"));
  const dossiers: DossierDirectoryPublicationPort = {
    profile: { supported: true, profile: "test", crash_safety: "process-crash", physical_durability: false },
    async publishCreateOnce(relativeDirectory, contents) {
      const target = resolve(root, relativeDirectory);
      const staging = `${target}.staging`;
      await mkdir(staging);
      for (const relativePath of contents.directories) await mkdir(join(staging, relativePath));
      for (const [relativePath, bytes] of Object.entries(contents.files)) {
        const path = join(staging, relativePath);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes, { flag: "wx" });
      }
      await rename(staging, target);
    },
  };
  let guardNumber = 0;
  let runNumber = 0;
  const store = new CaseStore(root, schemas);
  const ports: WorkflowPorts = {
    repository_root: root,
    store,
    schemas,
    evidenceFs: nodePathInspection,
    fs: controlledAtomicFs(root),
    dossiers,
    processIdentity: {
      current: async () => ({ profile: "test", pid: "1", process_started_at: timestamp }),
      verifyTerminated: async () => "terminated",
    },
    clock: { now: () => timestamp, isPossiblyStale: () => false },
    ids: {
      createGuardId: () => `guard-${++guardNumber}`,
      tempIdFor: (guardId) => `temp-${guardId}`,
      envelopeIdFor: (kind, operationId) => `${kind}-${operationId}`,
      createDossierId: () => "dossier-a",
      createRunId: () => `run-${String.fromCharCode(97 + runNumber++)}`,
      evidenceIdFor: (operationId) => `evidence-${operationId}`,
    },
  };
  const created = await createDossier({
    operation_id: "op-create",
    actor_id: "actor-a",
    title: "Handoff",
    objective: "Transfer the active writer",
    scope: { in: ["artifact"], out: [] },
    constraints: [],
    acceptance_criteria: [{
      criterion_id: "criterion-a",
      statement: "The recipient records progress",
      verification: "recorded_human_review",
    }],
  }, ports);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("fixture creation failed");
  return { root, ports, snapshot: created.data.snapshot };
}

function offerRequest(
  snapshot: DossierSnapshot,
  operationId = "op-offer",
  fromRunId = snapshot.active_run.run_id,
): OfferHandoffRequest & MutationPrecondition {
  return {
    dossier_id: snapshot.dossier_id,
    expected_revision: snapshot.state_revision,
    expected_state_digest: snapshot.state_digest,
    operation_id: operationId,
    from_run_id: fromRunId,
    to_actor_id: "actor-b",
  };
}

function acceptRequest(
  offer: HandoffEnvelope,
  snapshot: DossierSnapshot,
  actorId = "actor-b",
  operationId = "op-accept",
): AcceptHandoffRequest & MutationPrecondition {
  return {
    dossier_id: snapshot.dossier_id,
    expected_revision: snapshot.state_revision,
    expected_state_digest: snapshot.state_digest,
    operation_id: operationId,
    handoff_id: offer.handoff_id,
    offered_content_digest: offer.offered_content_digest,
    actor_id: actorId,
  };
}

function evidenceRequest(snapshot: DossierSnapshot, runId: string, operationId: string): AddEvidenceRequest {
  return {
    dossier_id: snapshot.dossier_id,
    expected_revision: snapshot.state_revision,
    expected_state_digest: snapshot.state_digest,
    operation_id: operationId,
    run_id: runId,
    criterion_ids: ["criterion-a"],
    kind: "human_observation",
    location: { statement: "Progress recorded" },
    freshness: "human_review",
    limitations: ["Recorded claim only"],
  };
}

async function writeSnapshot(root: string, snapshot: DossierSnapshot): Promise<DossierSnapshot> {
  const fixed = { ...snapshot, state_digest: digestProjection(projectState(snapshot)) };
  await writeFile(join(root, ".case-agent", "dossiers", snapshot.dossier_id, "dossier.json"), `${JSON.stringify(fixed)}\n`);
  return fixed;
}

test("recipient accepts only the still-current offer", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const withReviewPointers = await writeSnapshot(root, {
    ...snapshot,
    current_submission_id: "submission-current",
    current_decision_id: "decision-current",
  });

  const offered = await offerHandoff(offerRequest(withReviewPointers), ports);

  assert.equal(offered.ok, true);
  if (!offered.ok) return;
  const published = await ports.store.loadDossier(snapshot.dossier_id);
  assert.equal(offered.command, "handoff.offer");
  assert.equal(offered.data.from_run_id, "run-a");
  assert.equal(offered.data.to_actor_id, "actor-b");
  assert.equal(offered.data.basis_revision, "0");
  assert.equal(offered.data.basis_state_digest, withReviewPointers.state_digest);
  assert.equal(offered.data.published_revision, "1");
  assert.equal(offered.data.offered_content_digest, digestProjection(projectContent(withReviewPointers)));
  assert.equal(Object.hasOwn(offered.data, "status"), false);
  assert.equal(published.active_run.run_id, "run-a");
  assert.equal(published.current_submission_id, "submission-current");
  assert.equal(published.current_decision_id, "decision-current");

  const accepted = await acceptHandoff(acceptRequest(offered.data, published), ports);

  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.command, "handoff.accept");
  assert.equal(accepted.data.active_run.actor_id, "actor-b");
  assert.equal(accepted.data.active_run.run_id, "run-b");
  assert.equal(accepted.data.active_run.started_by_handoff_id, offered.data.handoff_id);
  assert.equal(accepted.data.current_submission_id, "submission-current");
  assert.equal(accepted.data.current_decision_id, "decision-current");
});

test("an identical offer retry returns the original immutable offer", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const request = offerRequest(snapshot);
  const offered = await offerHandoff(request, ports);
  assert.equal(offered.ok, true);
  if (!offered.ok) return;

  const retried = await offerHandoff(request, ports);

  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.deepEqual(retried.data, offered.data);
  assert.equal((await ports.store.loadDossier(snapshot.dossier_id)).state_revision, "1");
});

test("an identical acceptance retry returns the originally created run", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const offered = await offerHandoff(offerRequest(snapshot), ports);
  assert.equal(offered.ok, true);
  if (!offered.ok) return;
  const published = await ports.store.loadDossier(snapshot.dossier_id);
  const request = acceptRequest(offered.data, published);
  const accepted = await acceptHandoff(request, ports);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;

  const retried = await acceptHandoff(request, ports);

  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.data.active_run.run_id, accepted.data.active_run.run_id);
  assert.equal(retried.data.state_revision, "2");
});

test("intervening governed work stales an unaccepted offer", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const offered = await offerHandoff(offerRequest(snapshot), ports);
  assert.equal(offered.ok, true);
  if (!offered.ok) return;
  const published = await ports.store.loadDossier(snapshot.dossier_id);
  const advanced = await addEvidence(evidenceRequest(published, "run-a", "op-progress"), ports);
  assert.equal(advanced.ok, true);
  if (!advanced.ok) return;

  const accepted = await acceptHandoff(acceptRequest(offered.data, advanced.data.snapshot), ports);

  assert.equal(accepted.code, "CASE_E_CONFLICT");
});

test("a different actor label cannot accept the offer", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const offered = await offerHandoff(offerRequest(snapshot), ports);
  assert.equal(offered.ok, true);
  if (!offered.ok) return;
  const published = await ports.store.loadDossier(snapshot.dossier_id);

  const accepted = await acceptHandoff(acceptRequest(offered.data, published, "actor-c"), ports);

  assert.equal(accepted.code, "CASE_E_ACTOR");
  assert.equal((await ports.store.loadDossier(snapshot.dossier_id)).active_run.run_id, "run-a");
});

test("an inactive from-run cannot offer a handoff", async (t) => {
  const { ports, snapshot } = await fixture(t);

  const offered = await offerHandoff(offerRequest(snapshot, "op-inactive", "run-old"), ports);

  assert.equal(offered.code, "CASE_E_ACTOR");
  assert.equal((await ports.store.loadDossier(snapshot.dossier_id)).current_handoff_id, null);
});

test("an accepted offer cannot be accepted a second time", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const offered = await offerHandoff(offerRequest(snapshot), ports);
  assert.equal(offered.ok, true);
  if (!offered.ok) return;
  const published = await ports.store.loadDossier(snapshot.dossier_id);
  const accepted = await acceptHandoff(acceptRequest(offered.data, published), ports);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;

  const second = await acceptHandoff(acceptRequest(offered.data, accepted.data, "actor-b", "op-accept-again"), ports);

  assert.equal(second.code, "CASE_E_TRANSITION");
});

test("the old writer loses mutation authority immediately after acceptance", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const offered = await offerHandoff(offerRequest(snapshot), ports);
  assert.equal(offered.ok, true);
  if (!offered.ok) return;
  const published = await ports.store.loadDossier(snapshot.dossier_id);
  const accepted = await acceptHandoff(acceptRequest(offered.data, published), ports);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;

  const oldWriter = await addEvidence(evidenceRequest(accepted.data, "run-a", "op-old-writer"), ports);

  assert.equal(oldWriter.code, "CASE_E_ACTOR");
});

test("a later offer replaces the current unaccepted reference", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const first = await offerHandoff(offerRequest(snapshot, "op-offer-first"), ports);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const firstPublished = await ports.store.loadDossier(snapshot.dossier_id);
  const second = await offerHandoff(offerRequest(firstPublished, "op-offer-second"), ports);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const secondPublished = await ports.store.loadDossier(snapshot.dossier_id);

  const oldOffer = await acceptHandoff(acceptRequest(first.data, secondPublished, "actor-b", "op-accept-old"), ports);

  assert.equal(oldOffer.code, "CASE_E_CONFLICT");
  assert.equal(secondPublished.current_handoff_id, second.data.handoff_id);
});

test("accepted status remains terminal through later ordinary work", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const offered = await offerHandoff(offerRequest(snapshot), ports);
  assert.equal(offered.ok, true);
  if (!offered.ok) return;
  const published = await ports.store.loadDossier(snapshot.dossier_id);
  const accepted = await acceptHandoff(acceptRequest(offered.data, published), ports);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const advanced = await addEvidence(evidenceRequest(accepted.data, "run-b", "op-recipient-progress"), ports);
  assert.equal(advanced.ok, true);

  const shown = await showDossier({ dossier_id: snapshot.dossier_id }, ports);

  assert.equal(shown.ok, true);
  assert.equal(shown.ok && shown.data.handoff, "accepted");
});

test("a later handoff replaces the current accepted reference", async (t) => {
  const { ports, snapshot } = await fixture(t);
  const first = await offerHandoff(offerRequest(snapshot, "op-offer-a-to-b"), ports);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const firstPublished = await ports.store.loadDossier(snapshot.dossier_id);
  const accepted = await acceptHandoff(acceptRequest(first.data, firstPublished), ports);
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;

  const second = await offerHandoff({
    ...offerRequest(accepted.data, "op-offer-b-to-c", "run-b"),
    to_actor_id: "actor-c",
  }, ports);

  assert.equal(second.ok, true);
  if (!second.ok) return;
  const shown = await showDossier({ dossier_id: snapshot.dossier_id }, ports);
  assert.equal(shown.ok, true);
  assert.equal(shown.ok && shown.data.handoff, "offered");
  assert.equal((await ports.store.loadDossier(snapshot.dossier_id)).current_handoff_id, second.data.handoff_id);
});

test("orphan reuse validates every deterministic handoff field", async (t) => {
  const { root, ports, snapshot } = await fixture(t);
  const request = offerRequest(snapshot, "op-orphan");
  const handoffId = "handoff-op-orphan";
  const altered: HandoffEnvelope = {
    handoff_id: handoffId,
    dossier_id: snapshot.dossier_id,
    from_run_id: snapshot.active_run.run_id,
    to_actor_id: request.to_actor_id,
    basis_revision: snapshot.state_revision,
    basis_state_digest: snapshot.state_digest,
    published_revision: "1" as never,
    offered_content_digest: digestProjection({ altered: "content" }),
    created_operation_id: request.operation_id,
  };
  const orphanPath = join(root, ".case-agent", "dossiers", snapshot.dossier_id, "handoffs", `${handoffId}.json`);
  const orphanBytes = `${JSON.stringify(altered)}\n`;
  await writeFile(orphanPath, orphanBytes);

  const result = await offerHandoff(request, ports);

  assert.equal(result.code, "CASE_E_CONFLICT");
  assert.equal((await ports.store.loadDossier(snapshot.dossier_id)).current_handoff_id, null);
  assert.equal(await readFile(orphanPath, "utf8"), orphanBytes);
});
