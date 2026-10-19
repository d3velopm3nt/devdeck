//! Allowlisted failure categories: never persist CLI output, prompts or credentials.
pub fn failure(exit: Option<i32>, diagnostic: &str) -> String {
    let text = diagnostic.to_ascii_lowercase();
    let has = |terms: &[&str]| terms.iter().any(|term| text.contains(term));
    let detail = if has(&["model_not_found", "unsupported_model", "model is not supported", "model does not exist", "not supported when using codex", "does not support the requested model"]) {
        "Model unavailable: the selected model is not supported or accessible. Choose an available model in Providers."
    } else if has(&["context_length_exceeded", "context window", "maximum context", "too many tokens", "prompt is too long"]) {
        "Request exceeds the model context limit. Reduce the supplied history or context before retrying."
    } else if has(&["insufficient_quota", "usage limit", "rate_limit", "rate limit", "too many requests", "quota exceeded"]) {
        "Account usage or rate limit reached. Check plan availability before retrying."
    } else if has(&["unauthorized", "authentication", "token expired", "refresh token", "not logged in", "please log in", "invalid_api_key"]) {
        "Authentication failed. Check the subscription sign-in in Providers."
    } else if has(&["invalid_json_schema", "invalid schema", "response_format", "output schema"]) {
        "The provider rejected the structured response schema. Check the CLI integration before retrying."
    } else if has(&["unexpected argument", "unrecognized argument", "unknown option", "unknown flag"]) {
        "The CLI rejected an invocation option. Check compatibility with the installed CLI version."
    } else if has(&["connection refused", "connection reset", "connection closed", "failed to connect", "dns error", "error sending request", "stream disconnected", "tls", "certificate"]) {
        "Connection to the provider failed. Check network access and service availability."
    } else if has(&["timed out", "timeout"]) {
        "The provider request timed out. This is a request timeout, not the overall work deadline."
    } else if has(&["internal server error", "service unavailable", "server_error", "overloaded"]) {
        "The provider reported a service error. Retry when the service is available."
    } else {
        "The CLI did not provide a recognized failure category. Check its account and configuration; the underlying cause is still unknown."
    };
    let code = exit.map(|code| format!(" (exit {code})")).unwrap_or_default();
    format!("Subscription CLI failed{code}. {detail} No actions from this request were executed; earlier work is preserved.")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn distinguishes_model_from_limits() {
        assert!(failure(Some(1), "This model is not supported when using Codex").contains("Model unavailable"));
        assert!(failure(Some(1), "usage limit reached").contains("usage or rate limit"));
        assert!(failure(Some(1), "context_length_exceeded").contains("context limit"));
    }
    #[test] fn never_copies_sensitive_or_unrecognized_output() {
        for text in ["unauthorized bearer secret-token /private/account", "unknown error secret-token /private/account"] {
            let result = failure(Some(2), text);
            assert!(!result.contains("secret-token"));
            assert!(!result.contains("/private/account"));
            assert!(result.contains("exit 2"));
            assert!(result.contains("earlier work is preserved"));
        }
    }
    #[test] fn distinguishes_protocol_network_and_unknown() {
        assert!(failure(None, "unexpected argument --something").contains("invocation option"));
        assert!(failure(None, "stream disconnected").contains("Connection"));
        assert!(failure(None, "something else").contains("cause is still unknown"));
    }
}
