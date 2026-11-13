"""Archive bundle assembly and structured verification reporting."""
import hashlib
import io
import json
import zipfile


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def build_verification_report(manifest, stored_manifest_hash, snapshot_payload=None,
                              snapshot_hash_value=None, signoff=None, closure=None):
    manifest_bytes = canonical_json(manifest).encode("utf-8")
    components = manifest.get("components", {})
    calculated_component_hash = hashlib.sha256(canonical_json(components).encode("utf-8")).hexdigest()
    checks = [
        {"name": "manifest_sha256", "valid": sha256_bytes(manifest_bytes) == stored_manifest_hash,
         "scope": "stored manifest JSON"},
        {"name": "component_sha256", "valid": calculated_component_hash == manifest.get("component_sha256"),
         "scope": "canonical components object"},
    ]
    snapshot_ref = components.get("handover_snapshot", {})
    signoff_ref = components.get("closeout_signoff", {})
    closure_ref = components.get("closure", {})
    if snapshot_payload is not None and snapshot_hash_value is not None:
        actual_snapshot_hash = hashlib.sha256(canonical_json(snapshot_payload).encode("utf-8")).hexdigest()
        snapshot_valid = actual_snapshot_hash == snapshot_hash_value == snapshot_ref.get("sha256")
    else:
        snapshot_valid = False
    checks.append({"name": "approved_snapshot", "valid": snapshot_valid,
                   "scope": "snapshot contents and manifest reference"})
    checks.append({"name": "signoff_reference", "valid": bool(
        signoff and signoff.snapshot_hash == signoff_ref.get("snapshot_hash")
        and signoff.closeout_fingerprint == signoff_ref.get("fingerprint")
        and signoff.snapshot_id == snapshot_ref.get("id")),
        "scope": "source closeout sign-off"})
    checks.append({"name": "closure_reference", "valid": bool(
        closure and signoff and closure.signoff_id == signoff.id
        and closure.snapshot_hash == closure_ref.get("snapshot_hash")
        and closure.closeout_fingerprint == closure_ref.get("fingerprint")),
        "scope": "source project closure"})
    evidence_results = []
    for item in components.get("evidence_references", []):
        reference = str(item.get("reference", ""))
        digest = hashlib.sha256(reference.encode("utf-8")).hexdigest()
        stored_digest = item.get("reference_sha256")
        evidence_results.append({"kind": item.get("kind"), "record_id": item.get("record_id"),
            "reference_present": bool(reference),
            "reference_sha256_valid": (digest == stored_digest) if reference else not stored_digest,
            "scope": "reference string only; external file contents are not verified"})
    all_valid = all(x["valid"] for x in checks) and all(x["reference_sha256_valid"] for x in evidence_results)
    return {"schema_version": 1, "valid": all_valid,
        "manifest_sha256": stored_manifest_hash, "calculated_manifest_sha256": sha256_bytes(manifest_bytes),
        "component_sha256": manifest.get("component_sha256"),
        "calculated_component_sha256": calculated_component_hash,
        "checks": checks, "evidence_reference_checks": evidence_results,
        "limitations": [
            "A valid hash proves byte-level consistency, not legal authenticity or client identity.",
            "Evidence reference hashes cover reference strings, not the contents of linked files.",
            "The bundle includes the approved handover snapshot and its rendered PDF, not original source attachments.",
            "Payment and cost records remain manually entered and are not bank-verified.",
        ]}


def build_archive_bundle(manifest, manifest_id, manifest_version, manifest_hash,
                         snapshot_payload, snapshot_pdf, verification_report, outcome_payload=None):
    files = {
        "manifest.json": json.dumps({"id": manifest_id, "version": manifest_version,
            "manifest_hash": manifest_hash, "manifest": manifest}, sort_keys=True, indent=2,
            ensure_ascii=False).encode("utf-8"),
        "approved-handover/snapshot.json": json.dumps(snapshot_payload, sort_keys=True, indent=2,
            ensure_ascii=False).encode("utf-8"),
        "approved-handover/handover.pdf": snapshot_pdf,
        "verification/verification-report.json": json.dumps(verification_report, sort_keys=True,
            indent=2, ensure_ascii=False).encode("utf-8"),
        "README.txt": (
            "Freelance Income AI project archive bundle\n"
            f"Manifest ID: {manifest_id}\nVersion: {manifest_version}\n"
            f"Manifest SHA-256: {manifest_hash}\n\n"
            "Verify every exported file against SHA256SUMS.txt. Evidence reference hashes cover "
            "reference strings only; linked external documents are not embedded.\n"
        ).encode("utf-8"),
    }
    if outcome_payload is not None:
        files["outcome-review.json"] = json.dumps(outcome_payload, sort_keys=True, indent=2,
            ensure_ascii=False).encode("utf-8")
    files["SHA256SUMS.txt"] = "".join(
        f"{sha256_bytes(data)}  {name}\n" for name, data in sorted(files.items())
    ).encode("utf-8")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
    return output.getvalue()
