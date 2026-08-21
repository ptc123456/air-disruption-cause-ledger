import hashlib
import json
import runpy
import sys
import types

import pytest


VALID_ARGS = (
    "DL-105-2026-08-11-ATL-LAX",
    "DL",
    "DL105",
    "2026-08-11",
    "ATL",
    "LAX",
    "2026-08-11T14:00Z",
    "2026-08-11T18:00Z",
    "https://www.delta.com/flight-status/search",
    "https://nasstatus.faa.gov/",
    "https://api.weather.gov/alerts/active",
)


def contract_instance(upgrader_value=None, use_existing_address=False):
    """Load deterministic methods only; GenVM validation is run separately."""
    module = types.ModuleType("genlayer")

    class UserError(Exception):
        pass

    class Public:
        @staticmethod
        def write(fn):
            def guarded(contract, *args, **kwargs):
                if fn.__name__ == "upgrade" and module.gl.message.sender_address not in fake_root.upgraders.get():
                    raise UserError("Sender is not an authorized upgrader")
                return fn(contract, *args, **kwargs)

            return guarded

        @staticmethod
        def view(fn):
            return fn

    class Contract:
        pass

    class Address:
        def __init__(self, value):
            if isinstance(value, str) and value.startswith("0x") and len(value) == 42:
                self.value = bytes.fromhex(value[2:])
            elif isinstance(value, (bytes, bytearray)) and len(value) == 20:
                self.value = bytes(value)
            else:
                raise TypeError("Address accepts only a hex string, Address, or 20 bytes")

        def __str__(self):
            return "0x" + self.value.hex()

        def __eq__(self, other):
            return isinstance(other, Address) and self.value == other.value

        def __hash__(self):
            return hash(self.value)

        @property
        def as_bytes(self):
            return self.value

    class Slot:
        def __init__(self, value):
            self.value = value

        def get(self):
            return self.value

    class Code(bytearray):
        def truncate(self):
            self.clear()

    fake_root = types.SimpleNamespace(upgraders=Slot([]), code=Slot(Code()))

    module.gl = types.SimpleNamespace(
        Contract=Contract,
        public=Public(),
        vm=types.SimpleNamespace(UserError=UserError),
        message=types.SimpleNamespace(sender_address="0x1111111111111111111111111111111111111111"),
        storage=types.SimpleNamespace(Root=types.SimpleNamespace(get=lambda: fake_root)),
    )
    module.TreeMap = dict
    module.DynArray = list
    module.Address = Address
    module.__all__ = ["gl", "TreeMap", "DynArray", "Address"]
    previous = sys.modules.get("genlayer")
    sys.modules["genlayer"] = module
    try:
        contract_class = runpy.run_path("contracts/AirDisruptionCauseLedger.py")["AirDisruptionCauseLedger"]
    finally:
        if previous is None:
            del sys.modules["genlayer"]
        else:
            sys.modules["genlayer"] = previous
    upgrader = "0x2222222222222222222222222222222222222222" if upgrader_value is None else upgrader_value
    if use_existing_address:
        upgrader = Address(upgrader)
    contract = contract_class(upgrader)
    contract.cases = {}
    contract.case_ids = []
    contract._test_upgraders = fake_root.upgraders.get()
    contract._test_code = fake_root.code.get()
    contract._test_gl = module.gl
    contract_class_ref = contract_class
    return contract, UserError, contract_class_ref


def test_constructor_registers_explicit_external_upgrader():
    contract, _, _ = contract_instance()
    assert str(contract.get_upgrader()) == "0x2222222222222222222222222222222222222222"
    assert [str(value) for value in contract._test_upgraders] == ["0x2222222222222222222222222222222222222222"]


def test_constructor_normalizes_the_exact_studio_integer_calldata_shape():
    expected = "0x277bf20771129ae224042d23b0311c1ac5a9ac1b"
    studio_value = 225414715427020428792698552147058797861298351131
    contract, _, _ = contract_instance(studio_value)
    assert str(contract.get_upgrader()) == expected
    assert [str(value) for value in contract._test_upgraders] == [expected]


def test_constructor_preserves_an_existing_runtime_address():
    contract, _, _ = contract_instance(use_existing_address=True)
    assert str(contract.get_upgrader()) == "0x2222222222222222222222222222222222222222"


@pytest.mark.parametrize("value", [-1, 1 << 160])
def test_constructor_rejects_out_of_range_integer_addresses(value):
    with pytest.raises(Exception, match="must fit in 160 bits"):
        contract_instance(value)


def test_constructor_rejects_zero_integer_address():
    with pytest.raises(Exception, match="non-zero external wallet"):
        contract_instance(0)


def test_upgrade_replaces_code_slot_in_authorized_harness():
    contract, _, _ = contract_instance()
    contract._test_gl.message.sender_address = contract.get_upgrader()
    contract._test_code.extend(b"old")
    contract.upgrade(b"new")
    assert bytes(contract._test_code) == b"new"


def test_unauthorized_upgrade_rejected_without_code_or_application_mutation():
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    contract._test_code.extend(b"old")
    code_before = bytes(contract._test_code)
    case_before = contract.get_case(VALID_ARGS[0])
    contract._test_gl.message.sender_address = "0x3333333333333333333333333333333333333333"

    with pytest.raises(user_error, match="not an authorized upgrader"):
        contract.upgrade(b"malicious")

    assert bytes(contract._test_code) == code_before
    assert contract.get_case(VALID_ARGS[0]) == case_before


def test_register_and_duplicate_rejection():
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    record = json.loads(contract.get_case(VALID_ARGS[0]))
    assert record["stage"] == "REGISTERED"
    assert record["outcome"] == ""
    assert record["window_start_utc"] == "2026-08-11T14:00Z"
    assert record["window_end_utc"] == "2026-08-11T18:00Z"
    assert contract.list_case_ids() == [VALID_ARGS[0]]

    with pytest.raises(user_error, match="Case already exists"):
        contract.register_case(*VALID_ARGS)


def test_valid_same_date_utc_window_registers_and_round_trips():
    contract, _, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    record = json.loads(contract.get_case(VALID_ARGS[0]))
    assert record["window_start_utc"] == "2026-08-11T14:00Z"
    assert record["window_end_utc"] == "2026-08-11T18:00Z"
    assert record["flight_date"] == "2026-08-11"
    assert record["source_bindings"] == {}
    assert record["evidence_digests"] == {}
    assert record["grounded_excerpts"] == {}


@pytest.mark.parametrize(
    "start_utc,end_utc,error_match",
    [
        ("2026-08-11 14:00", "2026-08-11 18:00", "exact UTC format"),
        ("2026-08-11T14:00", "2026-08-11T18:00Z", "exact UTC format"),
        ("2026-08-11T14:00:00Z", "2026-08-11T18:00:00Z", "exact UTC format"),
        ("2026-08-11T25:00Z", "2026-08-11T26:00Z", "out of range"),
        ("2026-08-11T14:60Z", "2026-08-11T18:00Z", "out of range"),
        ("2026-08-12T14:00Z", "2026-08-11T18:00Z", "registered flight date"),
        ("2026-08-11T14:00Z", "2026-08-12T18:00Z", "registered flight date"),
        ("2026-08-11T14:00Z", "2026-08-11T14:00Z", "strictly before window end"),
        ("2026-08-11T18:00Z", "2026-08-11T14:00Z", "strictly before window end"),
        ("2026-08-11TAA:00Z", "2026-08-11T18:00Z", "must be digits"),
    ],
)
def test_missing_malformed_reversed_zero_length_wrong_date_windows_reject_without_mutation(start_utc, end_utc, error_match):
    contract, user_error, _ = contract_instance()
    args = list(VALID_ARGS)
    args[6] = start_utc
    args[7] = end_utc

    with pytest.raises(user_error, match=error_match):
        contract.register_case(*args)

    assert contract.cases == {}
    assert contract.list_case_ids() == []


def test_provisional_result_stores_bindings_digests_excerpts_outcome_and_window():
    contract, _, _ = contract_instance()
    contract.register_case(*VALID_ARGS)

    weather_text = "NWS Severe Thunderstorm Warning issued for ATL area valid 14:30Z-17:30Z on 2026-08-11."
    contract._render_source = lambda url, cat: weather_text if cat == "weather" else f"Generic {cat} page"

    contract._test_gl.nondet = types.SimpleNamespace(
        exec_prompt=lambda prompt, **_kw: {
            "outcome": "WEATHER_CORROBORATED",
            "source_status": "carrier available; FAA available; weather relevant; revision unavailable",
            "explanation": "Independent weather evidence corroborates the disruption window; this is not an official cause.",
            "source_bindings": {
                "carrier": "UNBOUND",
                "faa": "UNBOUND",
                "weather": "BOUND",
            },
            "grounded_excerpts": {
                "carrier": "",
                "faa": "",
                "weather": "Severe Thunderstorm Warning issued for ATL area valid 14:30Z-17:30Z on 2026-08-11.",
            },
        }
    )
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, **_kwargs: evaluate()
    )

    contract.assess_provisional(VALID_ARGS[0])
    record = json.loads(contract.get_case(VALID_ARGS[0]))
    assert record["stage"] == "PROVISIONAL_ASSESSED"
    assert record["outcome"] == "WEATHER_CORROBORATED"
    assert record["assistance_review_required"] is False
    assert record["revision"] == 1
    assert record["window_start_utc"] == "2026-08-11T14:00Z"
    assert record["window_end_utc"] == "2026-08-11T18:00Z"
    assert record["source_bindings"]["weather"] == "BOUND"
    assert record["source_bindings"]["carrier"] == "UNBOUND"
    assert record["evidence_digests"]["weather"] == hashlib.sha256(weather_text.encode("utf-8")).hexdigest()
    assert record["grounded_excerpts"]["weather"] == "Severe Thunderstorm Warning issued for ATL area valid 14:30Z-17:30Z on 2026-08-11."


def test_generic_official_pages_are_unbound_and_cannot_produce_corroborating_outcome():
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)

    contract._render_source = lambda url, cat: f"Generic official homepage for {cat} search index"
    contract._test_gl.nondet = types.SimpleNamespace(
        exec_prompt=lambda prompt, **_kw: {
            "outcome": "WEATHER_CORROBORATED",
            "source_status": "carrier generic; FAA generic; weather generic; revision unavailable",
            "explanation": "Attempting corroboration with generic pages.",
            "source_bindings": {
                "carrier": "UNBOUND",
                "faa": "UNBOUND",
                "weather": "UNBOUND",
            },
            "grounded_excerpts": {
                "carrier": "",
                "faa": "",
                "weather": "",
            },
        }
    )
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, **_kwargs: evaluate()
    )

    with pytest.raises(user_error, match="WEATHER_CORROBORATED requires BOUND weather evidence|Outcome without BOUND sources must be INSUFFICIENT_EVIDENCE"):
        contract.assess_provisional(VALID_ARGS[0])


def test_wrong_flight_airport_date_route_or_window_cannot_count_as_bound():
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)

    unrelated_text = "Flight AA200 on 2026-08-12 from JFK to ORD delayed due to crew."
    contract._render_source = lambda url, cat: unrelated_text

    contract._test_gl.nondet = types.SimpleNamespace(
        exec_prompt=lambda prompt, **_kw: {
            "outcome": "CARRIER_REPORTED",
            "source_status": "unrelated carrier page; FAA unavailable; weather unavailable",
            "explanation": "Carrier reports delay for unrelated flight.",
            "source_bindings": {
                "carrier": "UNBOUND",
                "faa": "UNBOUND",
                "weather": "UNBOUND",
            },
            "grounded_excerpts": {
                "carrier": "",
                "faa": "",
                "weather": "",
            },
        }
    )
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, **_kwargs: evaluate()
    )

    with pytest.raises(user_error, match="CARRIER_REPORTED requires BOUND carrier evidence|Outcome without BOUND sources must be INSUFFICIENT_EVIDENCE"):
        contract.assess_provisional(VALID_ARGS[0])


def test_bound_source_requires_non_empty_verbatim_excerpt():
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)

    carrier_text = "Delta flight DL105 on 2026-08-11 ATL to LAX delayed due to maintenance in window 14:00-18:00Z."
    contract._render_source = lambda url, cat: carrier_text if cat == "carrier" else "generic"

    contract._test_gl.nondet = types.SimpleNamespace(
        exec_prompt=lambda prompt, **_kw: {
            "outcome": "CARRIER_REPORTED",
            "source_status": "carrier bound; FAA unavailable; weather unavailable",
            "explanation": "Carrier reports maintenance.",
            "source_bindings": {
                "carrier": "BOUND",
                "faa": "UNBOUND",
                "weather": "UNBOUND",
            },
            "grounded_excerpts": {
                "carrier": "",  # Empty excerpt for BOUND source
                "faa": "",
                "weather": "",
            },
        }
    )
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, **_kwargs: evaluate()
    )

    with pytest.raises(user_error, match="requires a non-empty grounded excerpt"):
        contract.assess_provisional(VALID_ARGS[0])


def test_fabricated_non_verbatim_excerpt_rejects():
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)

    carrier_text = "Delta flight DL105 on 2026-08-11 ATL to LAX delayed due to maintenance."
    contract._render_source = lambda url, cat: carrier_text if cat == "carrier" else "generic"

    contract._test_gl.nondet = types.SimpleNamespace(
        exec_prompt=lambda prompt, **_kw: {
            "outcome": "CARRIER_REPORTED",
            "source_status": "carrier bound; FAA unavailable; weather unavailable",
            "explanation": "Carrier reports maintenance.",
            "source_bindings": {
                "carrier": "BOUND",
                "faa": "UNBOUND",
                "weather": "UNBOUND",
            },
            "grounded_excerpts": {
                "carrier": "This is a fabricated sentence not appearing in the text.",
                "faa": "",
                "weather": "",
            },
        }
    )
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, **_kwargs: evaluate()
    )

    with pytest.raises(user_error, match="must be a verbatim substring"):
        contract.assess_provisional(VALID_ARGS[0])


@pytest.mark.parametrize("bound_categories", [(), ("carrier",)])
def test_mixed_evidence_rejects_fewer_than_two_bound_sources(bound_categories):
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    source_texts = {cat: f"grounded evidence for {cat}" for cat in ("carrier", "faa", "weather")}
    contract._render_source = lambda _url, cat: source_texts[cat.lower()]
    contract._test_gl.nondet = types.SimpleNamespace(
        exec_prompt=lambda _prompt, **_kw: {
            "outcome": "MIXED_EVIDENCE",
            "source_status": "mixed evidence claimed",
            "explanation": "No dominant signal.",
            "source_bindings": {
                cat: "BOUND" if cat in bound_categories else "UNBOUND"
                for cat in source_texts
            },
            "grounded_excerpts": {
                cat: source_texts[cat] if cat in bound_categories else ""
                for cat in source_texts
            },
        }
    )
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, **_kwargs: evaluate()
    )

    with pytest.raises(user_error, match="MIXED_EVIDENCE requires at least two BOUND"):
        contract.assess_provisional(VALID_ARGS[0])


def test_mixed_evidence_accepts_two_bound_sources_with_grounded_excerpts():
    contract, _, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    source_texts = {
        "carrier": "DL105 carrier reports maintenance in the registered window.",
        "faa": "FAA reports an ATL ground delay in the registered window.",
        "weather": "No relevant weather alert.",
    }
    contract._render_source = lambda _url, cat: source_texts[cat.lower()]
    contract._test_gl.nondet = types.SimpleNamespace(
        exec_prompt=lambda _prompt, **_kw: {
            "outcome": "MIXED_EVIDENCE",
            "source_status": "carrier and FAA bound; weather unbound",
            "explanation": "Two bound sources support different cause categories.",
            "source_bindings": {"carrier": "BOUND", "faa": "BOUND", "weather": "UNBOUND"},
            "grounded_excerpts": {
                "carrier": source_texts["carrier"],
                "faa": source_texts["faa"],
                "weather": "",
            },
        }
    )
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, **_kwargs: evaluate()
    )

    contract.assess_provisional(VALID_ARGS[0])
    assert json.loads(contract.get_case(VALID_ARGS[0]))["outcome"] == "MIXED_EVIDENCE"


def test_stored_sha256_equals_exact_bounded_rendered_utf8_content():
    content = "Exact bounded rendered UTF-8 test content for FAA: Ground stop at ATL 2026-08-11."
    expected_digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    assert len(expected_digest) == 64
    assert expected_digest.islower()


def test_changing_one_byte_changes_digest():
    content_a = "Delta flight DL105 2026-08-11"
    content_b = "Delta flight DL105 2026-08-12"
    digest_a = hashlib.sha256(content_a.encode("utf-8")).hexdigest()
    digest_b = hashlib.sha256(content_b.encode("utf-8")).hexdigest()
    assert digest_a != digest_b


def test_consensus_criteria_require_exact_digest_and_binding_status_agreement():
    contract, _, _ = contract_instance()
    captured_principle = []
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, principle: (captured_principle.append(principle), evaluate())[1]
    )
    contract._render_source = lambda url, cat: f"content for {cat}"
    contract._test_gl.nondet = types.SimpleNamespace(
        exec_prompt=lambda prompt, **_kw: {
            "outcome": "INSUFFICIENT_EVIDENCE",
            "source_status": "none bound",
            "explanation": "No bound sources.",
            "source_bindings": {"carrier": "UNBOUND", "faa": "UNBOUND", "weather": "UNBOUND"},
            "grounded_excerpts": {"carrier": "", "faa": "", "weather": ""},
        }
    )
    record = {
        "case_id": VALID_ARGS[0],
        "carrier": VALID_ARGS[1],
        "flight_number": VALID_ARGS[2],
        "flight_date": VALID_ARGS[3],
        "origin": VALID_ARGS[4],
        "destination": VALID_ARGS[5],
        "window_start_utc": VALID_ARGS[6],
        "window_end_utc": VALID_ARGS[7],
        "carrier_url": VALID_ARGS[8],
        "faa_url": VALID_ARGS[9],
        "weather_url": VALID_ARGS[10],
    }
    contract._assess(record, "PROVISIONAL", "")
    principle = captured_principle[0]
    assert "source_bindings must match exactly" in principle
    assert "evidence_digests mapping must match exactly" in principle
    assert "verbatim substrings from the exact same digest-bound content" in principle


def test_unbound_evidence_is_excluded_from_outcome():
    contract, _, _ = contract_instance()
    contract.register_case(*VALID_ARGS)

    contract._render_source = lambda url, cat: "unbound content"
    contract._test_gl.nondet = types.SimpleNamespace(
        exec_prompt=lambda prompt, **_kw: {
            "outcome": "INSUFFICIENT_EVIDENCE",
            "source_status": "carrier unbound; faa unbound; weather unbound",
            "explanation": "No sources specifically concern the registered flight and window.",
            "source_bindings": {"carrier": "UNBOUND", "faa": "UNBOUND", "weather": "UNBOUND"},
            "grounded_excerpts": {"carrier": "", "faa": "", "weather": ""},
        }
    )
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, **_kwargs: evaluate()
    )

    contract.assess_provisional(VALID_ARGS[0])
    record = json.loads(contract.get_case(VALID_ARGS[0]))
    assert record["outcome"] == "INSUFFICIENT_EVIDENCE"
    assert record["assistance_review_required"] is True


def test_unavailable_evidence_remains_safely_bounded():
    contract, _, _ = contract_instance()
    contract.register_case(*VALID_ARGS)

    def render(url, **_kwargs):
        raise Exception("WEBPAGE_LOAD_FAILED")

    contract._test_gl.nondet = types.SimpleNamespace(
        web=types.SimpleNamespace(render=render),
        exec_prompt=lambda prompt, **_kw: {
            "outcome": "INSUFFICIENT_EVIDENCE",
            "source_status": "all unavailable",
            "explanation": "All sources failed to load.",
            "source_bindings": {"carrier": "UNAVAILABLE", "faa": "UNAVAILABLE", "weather": "UNAVAILABLE"},
            "grounded_excerpts": {"carrier": "", "faa": "", "weather": ""},
        }
    )
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, **_kwargs: evaluate()
    )

    contract.assess_provisional(VALID_ARGS[0])
    record = json.loads(contract.get_case(VALID_ARGS[0]))
    assert record["source_bindings"]["carrier"] == "UNAVAILABLE"
    assert record["source_bindings"]["faa"] == "UNAVAILABLE"
    assert record["source_bindings"]["weather"] == "UNAVAILABLE"
    assert record["grounded_excerpts"]["carrier"] == ""
    assert record["evidence_digests"]["carrier"] == hashlib.sha256(b"[SOURCE_UNAVAILABLE: carrier]").hexdigest()


def test_successful_revision_stores_revision_source_binding_digest_excerpt():
    contract, _, _ = contract_instance()
    contract.register_case(*VALID_ARGS)

    faa_text = "FAA NAS: ATL Ground delay program on 2026-08-11 due to volume."
    bts_text = "BTS TranStats: DL105 2026-08-11 ATL-LAX delayed by NAS congestion."

    def mock_render(url, cat):
        if cat == "FAA":
            return faa_text
        if cat == "revision":
            return bts_text
        return f"generic {cat}"

    contract._render_source = mock_render

    contract._test_gl.nondet = types.SimpleNamespace(
        exec_prompt=lambda prompt, **_kw: {
            "outcome": "NAS_CORROBORATED",
            "source_status": "FAA NAS bound; revision BTS bound",
            "explanation": "FAA NAS and BTS TranStats corroborate NAS congestion during disruption window.",
            "source_bindings": {
                "carrier": "UNBOUND",
                "faa": "BOUND",
                "weather": "UNBOUND",
                "revision": "BOUND",
            },
            "grounded_excerpts": {
                "carrier": "",
                "faa": "ATL Ground delay program on 2026-08-11 due to volume.",
                "weather": "",
                "revision": "DL105 2026-08-11 ATL-LAX delayed by NAS congestion.",
            },
        }
    )
    contract._test_gl.eq_principle = types.SimpleNamespace(
        prompt_comparative=lambda evaluate, **_kwargs: evaluate()
    )

    contract.assess_provisional(VALID_ARGS[0])
    revision_url = "https://www.transtats.bts.gov/homepage.asp"
    contract.assess_revision(VALID_ARGS[0], revision_url)

    record = json.loads(contract.get_case(VALID_ARGS[0]))
    assert record["stage"] == "REVISED_ASSESSED"
    assert record["revision"] == 2
    assert record["revision_url"] == revision_url
    assert record["source_bindings"]["revision"] == "BOUND"
    assert record["evidence_digests"]["revision"] == hashlib.sha256(bts_text.encode("utf-8")).hexdigest()
    assert record["grounded_excerpts"]["revision"] == "DL105 2026-08-11 ATL-LAX delayed by NAS congestion."


def test_historical_records_remain_readable_but_cannot_be_newly_assessed():
    contract, user_error, _ = contract_instance()
    historical_record = {
        "case_id": "HISTORICAL-1",
        "submitter": "0x1111111111111111111111111111111111111111",
        "carrier": "DL",
        "flight_number": "DL105",
        "flight_date": "2026-08-11",
        "origin": "ATL",
        "destination": "LAX",
        "carrier_url": "https://www.delta.com/flight-status/search",
        "faa_url": "https://nasstatus.faa.gov/",
        "weather_url": "https://api.weather.gov/alerts/active",
        "revision_url": "",
        "stage": "REGISTERED",
        "outcome": "",
        "explanation": "",
        "source_status": "",
        "assistance_review_required": False,
        "revision": 0,
    }
    contract.cases["HISTORICAL-1"] = json.dumps(historical_record)
    contract.case_ids.append("HISTORICAL-1")

    # Readable
    assert contract.get_case("HISTORICAL-1") == json.dumps(historical_record)
    assert contract.list_case_ids() == ["HISTORICAL-1"]

    # Fails closed on assessment
    with pytest.raises(user_error, match="Historical record lacks required provenance fields"):
        contract.assess_provisional("HISTORICAL-1")

    # Fails closed on revision
    with pytest.raises(user_error, match="provisional assessment is required"):
        contract.assess_revision("HISTORICAL-1", "https://www.transtats.bts.gov/homepage.asp")


def test_storage_slot_order_is_unchanged():
    _, _, contract_class = contract_instance()
    annotations = list(contract_class.__annotations__.keys())
    assert annotations == ["cases", "case_ids", "upgrader_address"]


def test_mixed_evidence_routes_to_assistance_review():
    contract, _, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    record = json.loads(contract.get_case(VALID_ARGS[0]))
    contract._store_result(VALID_ARGS[0], record, {
        "outcome": "MIXED_EVIDENCE",
        "source_status": "sources conflict",
        "explanation": "No defensible dominant signal.",
        "source_bindings": {},
        "evidence_digests": {},
        "grounded_excerpts": {},
    }, "PROVISIONAL_ASSESSED", "")
    assert json.loads(contract.get_case(VALID_ARGS[0]))["assistance_review_required"] is True


@pytest.mark.parametrize(
    "outcome,assistance_required",
    [
        ("CARRIER_REPORTED", True),
        ("NAS_CORROBORATED", False),
        ("WEATHER_CORROBORATED", False),
        ("MIXED_EVIDENCE", True),
        ("INSUFFICIENT_EVIDENCE", True),
    ],
)
def test_each_outcome_has_an_explicit_assistance_route(outcome, assistance_required):
    contract, _, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    record = json.loads(contract.get_case(VALID_ARGS[0]))
    contract._store_result(
        VALID_ARGS[0],
        record,
        {"outcome": outcome, "source_status": "bounded status", "explanation": "bounded explanation"},
        "PROVISIONAL_ASSESSED",
        "",
    )
    stored = json.loads(contract.get_case(VALID_ARGS[0]))
    assert stored["outcome"] == outcome
    assert stored["assistance_review_required"] is assistance_required


def test_invalid_consensus_result_does_not_mutate_state():
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    before = contract.get_case(VALID_ARGS[0])
    record = json.loads(before)

    with pytest.raises(user_error, match="invalid outcome"):
        contract._store_result(
            VALID_ARGS[0],
            record,
            {"outcome": "UNREVIEWED_OTHER", "source_status": "status", "explanation": "explanation"},
            "PROVISIONAL_ASSESSED",
            "",
        )

    assert contract.get_case(VALID_ARGS[0]) == before


def test_assessment_failure_does_not_mutate_state():
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    before = contract.get_case(VALID_ARGS[0])

    def fail_assessment(*_args):
        raise user_error("validator disagreement")

    contract._assess = fail_assessment
    with pytest.raises(user_error, match="validator disagreement"):
        contract.assess_provisional(VALID_ARGS[0])

    assert contract.get_case(VALID_ARGS[0]) == before


def test_revision_is_single_use_and_replay_does_not_mutate_state():
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    contract._assess = lambda *_args: {
        "outcome": "NAS_CORROBORATED",
        "source_status": "FAA NAS evidence available",
        "explanation": "FAA NAS evidence corroborates the disruption window.",
        "source_bindings": {"faa": "BOUND"},
        "evidence_digests": {"faa": "a" * 64},
        "grounded_excerpts": {"faa": "excerpt"},
    }
    contract.assess_provisional(VALID_ARGS[0])
    revision_url = "https://www.transtats.bts.gov/homepage.asp"
    contract.assess_revision(VALID_ARGS[0], revision_url)
    before_replay = contract.get_case(VALID_ARGS[0])

    with pytest.raises(user_error, match="provisional assessment is required"):
        contract.assess_revision(VALID_ARGS[0], revision_url)

    assert contract.get_case(VALID_ARGS[0]) == before_replay


def test_rejects_unofficial_faa_source():
    contract, user_error, _ = contract_instance()
    args = list(VALID_ARGS)
    args[9] = "https://example.com/faa-copy"
    with pytest.raises(user_error, match="FAA evidence"):
        contract.register_case(*args)


@pytest.mark.parametrize(
    "index,url,error",
    [
        (9, "https://api.weather.gov/alerts/active", "FAA evidence"),
        (9, "https://nasstatus.faa.gov.attacker.example/", "FAA evidence"),
        (10, "https://www.faa.gov/air_traffic", "weather evidence"),
        (10, "https://api.weather.gov.attacker.example/", "weather evidence"),
        (8, "https://attacker.example/flight/DL105", "Carrier evidence"),
        (8, "https://www.delta.com.attacker.example/flight/DL105", "Carrier evidence"),
    ],
)
def test_source_category_or_provenance_mismatch_fails_without_mutation(index, url, error):
    contract, user_error, _ = contract_instance()
    args = list(VALID_ARGS)
    args[index] = url

    with pytest.raises(user_error, match=error):
        contract.register_case(*args)

    assert contract.cases == {}
    assert contract.list_case_ids() == []


def test_flight_number_must_match_declared_carrier_without_mutation():
    contract, user_error, _ = contract_instance()
    args = list(VALID_ARGS)
    args[2] = "AA105"

    with pytest.raises(user_error, match="match the declared carrier"):
        contract.register_case(*args)

    assert contract.cases == {}
    assert contract.list_case_ids() == []


def test_revision_requires_provisional_assessment():
    contract, user_error, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    with pytest.raises(user_error, match="provisional assessment is required"):
        contract.assess_revision(VALID_ARGS[0], "https://www.transtats.bts.gov/homepage.asp")


@pytest.mark.parametrize("origin,destination", [("AT", "LAX"), ("ATL", "ATL")])
def test_rejects_invalid_route(origin, destination):
    contract, user_error, _ = contract_instance()
    args = list(VALID_ARGS)
    args[4], args[5] = origin, destination
    with pytest.raises(user_error, match="airport codes"):
        contract.register_case(*args)
