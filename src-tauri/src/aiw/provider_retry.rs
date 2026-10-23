//! Retry inference only. Tool actions are executed once, after a successful response.
pub fn run<T>(mut call: impl FnMut() -> Result<T, String>, stopped: impl Fn() -> bool, mut retrying: impl FnMut(usize)) -> Result<T, String> {
    for attempt in 1..=3 {
        if stopped() { return Err("Run stopped.".into()); }
        match call() {
            Ok(result) => return Ok(result),
            Err(error) if attempt == 3 => return Err(format!("Provider request failed after 3 attempts: {error}")),
            Err(_) => retrying(attempt + 1),
        }
    }
    unreachable!()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn stops_after_three_failures() {
        let mut calls = 0; let mut retries = Vec::new();
        let result = run(|| { calls += 1; Err::<(), _>("unavailable".into()) }, || false, |n| retries.push(n));
        assert_eq!(calls, 3); assert_eq!(retries, vec![2,3]);
        assert!(result.unwrap_err().contains("after 3 attempts"));
    }
    #[test] fn success_returns_once_and_each_request_has_its_own_budget() {
        for _ in 0..2 { let mut calls=0;
            assert_eq!(run(|| {calls+=1; if calls<3 {Err("temporary".into())} else {Ok(7)}}, || false, |_| {}), Ok(7));
            assert_eq!(calls,3);
        }
    }
    #[test] fn cancellation_prevents_another_attempt() {
        use std::cell::Cell; let stop=Cell::new(false); let mut calls=0;
        let result=run(|| {calls+=1; Err::<(),_>("temporary".into())}, || stop.get(), |_| stop.set(true));
        assert_eq!(calls,1); assert_eq!(result.unwrap_err(),"Run stopped.");
    }
}
