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
    "https://www.delta.com/flight-status/search",
    "https://nasstatus.faa.gov/",
    "https://api.weather.gov/alerts/active",
)


def contract_instance(upgrader_value=None):
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
            if isinstance(value, Address):
                self.value = value.value
            elif isinstance(value, str) and value.startswith("0x") and len(value) == 42:
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

    Address.ZERO = Address(bytes(20))

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
    contract = contract_class(upgrader)
    contract.cases = {}
    contract.case_ids = []
    contract._test_upgraders = fake_root.upgraders.get()
    contract._test_code = fake_root.code.get()
    contract._test_gl = module.gl
    return contract, UserError


def test_constructor_registers_explicit_external_upgrader():
    contract, _ = contract_instance()
    assert str(contract.get_upgrader()) == "0x2222222222222222222222222222222222222222"
    assert [str(value) for value in contract._test_upgraders] == ["0x2222222222222222222222222222222222222222"]


def test_constructor_normalizes_the_exact_studio_integer_calldata_shape():
    expected = "0x277bf20771129ae224042d23b0311c1ac5a9ac1b"
    studio_value = 225414715427020428792698552147058797861298351131
    contract, _ = contract_instance(studio_value)
    assert str(contract.get_upgrader()) == expected
    assert [str(value) for value in contract._test_upgraders] == [expected]


@pytest.mark.parametrize("value", [-1, 1 << 160])
def test_constructor_rejects_out_of_range_integer_addresses(value):
    with pytest.raises(Exception, match="must fit in 160 bits"):
        contract_instance(value)


def test_constructor_rejects_zero_integer_address():
    with pytest.raises(Exception, match="non-zero external wallet"):
        contract_instance(0)


def test_upgrade_replaces_code_slot_in_authorized_harness():
    contract, _ = contract_instance()
    contract._test_gl.message.sender_address = contract.get_upgrader()
    contract._test_code.extend(b"old")
    contract.upgrade(b"new")
    assert bytes(contract._test_code) == b"new"


def test_unauthorized_upgrade_rejected_without_code_or_application_mutation():
    contract, user_error = contract_instance()
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
    contract, user_error = contract_instance()
    contract.register_case(*VALID_ARGS)
    record = json.loads(contract.get_case(VALID_ARGS[0]))
    assert record["stage"] == "REGISTERED"
    assert record["outcome"] == ""
    assert contract.list_case_ids() == [VALID_ARGS[0]]

    with pytest.raises(user_error, match="Case already exists"):
        contract.register_case(*VALID_ARGS)


def test_provisional_result_changes_only_the_expected_state():
    contract, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    contract._assess = lambda record, phase, url: {
        "outcome": "WEATHER_CORROBORATED",
        "source_status": "carrier available; FAA available; weather relevant; revision unavailable",
        "explanation": "Independent weather evidence corroborates the disruption window; this is not an official cause.",
    }
    contract.assess_provisional(VALID_ARGS[0])
    record = json.loads(contract.get_case(VALID_ARGS[0]))
    assert record["stage"] == "PROVISIONAL_ASSESSED"
    assert record["outcome"] == "WEATHER_CORROBORATED"
    assert record["assistance_review_required"] is False
    assert record["revision"] == 1


def test_mixed_evidence_routes_to_assistance_review():
    contract, _ = contract_instance()
    contract.register_case(*VALID_ARGS)
    record = json.loads(contract.get_case(VALID_ARGS[0]))
    contract._store_result(VALID_ARGS[0], record, {
        "outcome": "MIXED_EVIDENCE",
        "source_status": "sources conflict",
        "explanation": "No defensible dominant signal.",
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
    contract, _ = contract_instance()
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
    contract, user_error = contract_instance()
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
    contract, user_error = contract_instance()
    contract.register_case(*VALID_ARGS)
    before = contract.get_case(VALID_ARGS[0])

    def fail_assessment(*_args):
        raise user_error("validator disagreement")

    contract._assess = fail_assessment
    with pytest.raises(user_error, match="validator disagreement"):
        contract.assess_provisional(VALID_ARGS[0])

    assert contract.get_case(VALID_ARGS[0]) == before


def test_revision_is_single_use_and_replay_does_not_mutate_state():
    contract, user_error = contract_instance()
    contract.register_case(*VALID_ARGS)
    contract._assess = lambda *_args: {
        "outcome": "NAS_CORROBORATED",
        "source_status": "FAA NAS evidence available",
        "explanation": "FAA NAS evidence corroborates the disruption window.",
    }
    contract.assess_provisional(VALID_ARGS[0])
    revision_url = "https://www.transtats.bts.gov/homepage.asp"
    contract.assess_revision(VALID_ARGS[0], revision_url)
    before_replay = contract.get_case(VALID_ARGS[0])

    with pytest.raises(user_error, match="provisional assessment is required"):
        contract.assess_revision(VALID_ARGS[0], revision_url)

    assert contract.get_case(VALID_ARGS[0]) == before_replay


def test_rejects_unofficial_faa_source():
    contract, user_error = contract_instance()
    args = list(VALID_ARGS)
    args[7] = "https://example.com/faa-copy"
    with pytest.raises(user_error, match="FAA evidence"):
        contract.register_case(*args)


@pytest.mark.parametrize(
    "index,url,error",
    [
        (7, "https://api.weather.gov/alerts/active", "FAA evidence"),
        (7, "https://nasstatus.faa.gov.attacker.example/", "FAA evidence"),
        (8, "https://www.faa.gov/air_traffic", "weather evidence"),
        (8, "https://api.weather.gov.attacker.example/", "weather evidence"),
        (6, "https://attacker.example/flight/DL105", "Carrier evidence"),
        (6, "https://www.delta.com.attacker.example/flight/DL105", "Carrier evidence"),
    ],
)
def test_source_category_or_provenance_mismatch_fails_without_mutation(index, url, error):
    contract, user_error = contract_instance()
    args = list(VALID_ARGS)
    args[index] = url

    with pytest.raises(user_error, match=error):
        contract.register_case(*args)

    assert contract.cases == {}
    assert contract.list_case_ids() == []


def test_flight_number_must_match_declared_carrier_without_mutation():
    contract, user_error = contract_instance()
    args = list(VALID_ARGS)
    args[2] = "AA105"

    with pytest.raises(user_error, match="match the declared carrier"):
        contract.register_case(*args)

    assert contract.cases == {}
    assert contract.list_case_ids() == []


def test_revision_requires_provisional_assessment():
    contract, user_error = contract_instance()
    contract.register_case(*VALID_ARGS)
    with pytest.raises(user_error, match="provisional assessment is required"):
        contract.assess_revision(VALID_ARGS[0], "https://www.transtats.bts.gov/homepage.asp")


@pytest.mark.parametrize("origin,destination", [("AT", "LAX"), ("ATL", "ATL")])
def test_rejects_invalid_route(origin, destination):
    contract, user_error = contract_instance()
    args = list(VALID_ARGS)
    args[4], args[5] = origin, destination
    with pytest.raises(user_error, match="airport codes"):
        contract.register_case(*args)
