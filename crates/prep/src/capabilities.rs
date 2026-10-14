//! Static protocol capabilities, independent from current archive readiness.
use serde_json::{json, Value};

pub(crate) fn document() -> Value {
    json!({
        "api_version": 1,
        "routes": ["/health", "/ready", "/height", "/query", "/transactions", "/capabilities"],
        "limits": {
            "max_request_bytes": crate::http::MAX_REQUEST_BYTES,
            "max_active_queries": crate::http::MAX_ACTIVE_QUERIES,
            "query_timeout_ms": crate::http::QUERY_TIMEOUT_SECONDS * 1000,
        },
        "query": {
            "max_scan_blocks": crate::query::MAX_SCAN_BLOCKS,
            "max_response_bytes": crate::query::MAX_RESPONSE_BYTES,
            "block_fields": crate::query::BLOCK_FIELDS,
            "transaction_fields": crate::query::TX_FIELDS,
            "transaction_filters": ["txids", "versions", "has_sapling", "has_orchard", "transparent_output_addresses"],
        },
        "transactions": {
            "max_ids": crate::transactions::MAX_LOOKUP_IDS,
            "max_range_blocks": crate::transactions::MAX_LOOKUP_BLOCKS,
            "max_records": crate::transactions::MAX_LOOKUP_RECORDS,
            "max_response_bytes": crate::transactions::MAX_LOOKUP_BYTES,
            "required_fields": crate::transactions::REQUIRED_LOOKUP_FIELDS,
            "default_fields": crate::transactions::DEFAULT_LOOKUP_FIELDS,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertised_fields_are_accepted_by_query_validation() {
        let value = document();
        for name in ["block_fields", "transaction_fields"] {
            for field in value["query"][name].as_array().unwrap() {
                let request = json!({
                    "from_block": 1, "to_block": 2,
                    "field_selection": {
                        "block": if name == "block_fields" { vec![field.clone()] } else { vec![] },
                        "transaction": if name == "transaction_fields" { vec![field.clone()] } else { vec![] },
                    },
                });
                let parsed = serde_json::from_value(request).unwrap();
                crate::query::validate_query(&parsed).unwrap();
            }
        }
        let defaults = value["transactions"]["default_fields"].as_array().unwrap();
        for required in value["transactions"]["required_fields"].as_array().unwrap() {
            assert!(defaults.contains(required));
        }
    }
}
