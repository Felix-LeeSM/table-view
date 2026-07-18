use crate::error::AppError;

use super::helpers::{bounded_limit, validate_key};

#[derive(Debug, Clone, PartialEq)]
pub(super) enum RedisCommand {
    Scan {
        cursor: String,
        pattern: Option<String>,
        count: Option<u32>,
    },
    Keys {
        pattern: String,
    },
    Get {
        key: String,
    },
    HGetAll {
        key: String,
    },
    LRange {
        key: String,
        start: i64,
        stop: i64,
    },
    SMembers {
        key: String,
    },
    ZRange {
        key: String,
        start: i64,
        stop: i64,
        with_scores: bool,
    },
    XRange {
        key: String,
        start: String,
        end: String,
        count: Option<u32>,
    },
    Type {
        key: String,
    },
    Ttl {
        key: String,
    },
    Exists {
        keys: Vec<String>,
    },
    Set {
        key: String,
        value: String,
        ttl_seconds: Option<u64>,
    },
    HSet {
        key: String,
        field: String,
        value: String,
    },
    HDel {
        key: String,
        fields: Vec<String>,
    },
    LPush {
        key: String,
        values: Vec<String>,
    },
    RPush {
        key: String,
        values: Vec<String>,
    },
    LSet {
        key: String,
        index: i64,
        value: String,
    },
    LRem {
        key: String,
        count: i64,
        value: String,
    },
    SAdd {
        key: String,
        members: Vec<String>,
    },
    SRem {
        key: String,
        members: Vec<String>,
    },
    ZAdd {
        key: String,
        score: f64,
        member: String,
    },
    JsonSet {
        key: String,
        path: String,
        value: String,
    },
    ZRem {
        key: String,
        members: Vec<String>,
    },
    Expire {
        key: String,
        seconds: u64,
    },
    Persist {
        key: String,
    },
    Del {
        key: String,
    },
    XAdd {
        key: String,
        id: String,
        fields: Vec<(String, String)>,
    },
    XDel {
        key: String,
        ids: Vec<String>,
    },
    XTrim {
        key: String,
        maxlen: u64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RedisCommandEffect {
    Read,
    Write,
    Ttl,
    Stream,
    Destructive,
}

impl RedisCommand {
    pub(super) fn effect(&self) -> RedisCommandEffect {
        match self {
            RedisCommand::Scan { .. }
            | RedisCommand::Keys { .. }
            | RedisCommand::Get { .. }
            | RedisCommand::HGetAll { .. }
            | RedisCommand::LRange { .. }
            | RedisCommand::SMembers { .. }
            | RedisCommand::ZRange { .. }
            | RedisCommand::Type { .. }
            | RedisCommand::Exists { .. } => RedisCommandEffect::Read,
            RedisCommand::Set { .. }
            | RedisCommand::HSet { .. }
            | RedisCommand::LPush { .. }
            | RedisCommand::RPush { .. }
            | RedisCommand::LSet { .. }
            | RedisCommand::SAdd { .. }
            | RedisCommand::ZAdd { .. }
            // JSON.SET overwrites the whole ReJSON slot (last-writer-wins), the
            // same non-destructive write tier as SET on a plain string (#PR3).
            | RedisCommand::JsonSet { .. }
            // XADD appends a new entry to an append-only log: it never mutates or
            // drops an existing entry, so it is the same non-destructive write
            // tier as SADD/ZADD (#1683 PR5b).
            | RedisCommand::XAdd { .. } => RedisCommandEffect::Write,
            RedisCommand::Ttl { .. }
            | RedisCommand::Expire { .. }
            | RedisCommand::Persist { .. } => RedisCommandEffect::Ttl,
            RedisCommand::XRange { .. } => RedisCommandEffect::Stream,
            // Element removals lose data and can drop the key itself once the
            // last element is gone (Redis GCs the now-empty collection), so they
            // are destructive without a typed key-confirmation gate (#1466).
            RedisCommand::Del { .. }
            | RedisCommand::HDel { .. }
            | RedisCommand::LRem { .. }
            | RedisCommand::SRem { .. }
            | RedisCommand::ZRem { .. }
            // XDEL drops whole stream entries and XTRIM discards entries past the
            // MAXLEN bound — both lose data, so they take the destructive tier
            // (danger confirm) like the other element removals (#1683 PR5b).
            | RedisCommand::XDel { .. }
            | RedisCommand::XTrim { .. } => RedisCommandEffect::Destructive,
        }
    }

    pub(super) fn required_confirmation_key(&self) -> Option<&str> {
        match self {
            RedisCommand::Del { key } | RedisCommand::Persist { key } => Some(key),
            _ => None,
        }
    }
}

pub(super) fn parse_redis_command(input: &str) -> Result<RedisCommand, AppError> {
    let tokens = tokenize(input)?;
    let Some((command, args)) = tokens.split_first() else {
        return Err(AppError::Validation("Redis command cannot be empty".into()));
    };
    let upper = command.to_ascii_uppercase();
    reject_command_family(&upper)?;
    match upper.as_str() {
        "SCAN" => parse_scan(args),
        "KEYS" => parse_keys(args),
        "GET" => Ok(RedisCommand::Get {
            key: one_key(args, "GET")?,
        }),
        "HGETALL" => Ok(RedisCommand::HGetAll {
            key: one_key(args, "HGETALL")?,
        }),
        "LRANGE" => parse_lrange(args),
        "SMEMBERS" => Ok(RedisCommand::SMembers {
            key: one_key(args, "SMEMBERS")?,
        }),
        "ZRANGE" => parse_zrange(args),
        "XRANGE" => parse_xrange(args),
        "TYPE" => Ok(RedisCommand::Type {
            key: one_key(args, "TYPE")?,
        }),
        "TTL" => Ok(RedisCommand::Ttl {
            key: one_key(args, "TTL")?,
        }),
        "EXISTS" => parse_exists(args),
        "SET" => parse_set(args),
        "HSET" => parse_hset(args),
        "HDEL" => parse_members(args, "HDEL", |key, fields| RedisCommand::HDel {
            key,
            fields,
        }),
        "LPUSH" | "RPUSH" => parse_list_push(&upper, args),
        "LSET" => parse_lset(args),
        "LREM" => parse_lrem(args),
        "SADD" => parse_sadd(args),
        "SREM" => parse_members(args, "SREM", |key, members| RedisCommand::SRem {
            key,
            members,
        }),
        "ZADD" => parse_zadd(args),
        "ZREM" => parse_members(args, "ZREM", |key, members| RedisCommand::ZRem {
            key,
            members,
        }),
        "JSON.SET" => parse_json_set(args),
        "EXPIRE" => parse_expire(args),
        "PERSIST" => Ok(RedisCommand::Persist {
            key: one_key(args, "PERSIST")?,
        }),
        "DEL" => Ok(RedisCommand::Del {
            key: one_key(args, "DEL")?,
        }),
        "XADD" => parse_xadd(args),
        "XDEL" => parse_members(args, "XDEL", |key, ids| RedisCommand::XDel { key, ids }),
        "XTRIM" => parse_xtrim(args),
        _ => Err(AppError::Unsupported(format!(
            "Redis command '{upper}' is not in the bounded command allowlist"
        ))),
    }
}

fn parse_scan(args: &[String]) -> Result<RedisCommand, AppError> {
    if args.is_empty() {
        return Err(AppError::Validation(
            "SCAN requires cursor and optional MATCH pattern / COUNT n".into(),
        ));
    }
    let mut pattern = None;
    let mut count = None;
    let mut index = 1;
    while index < args.len() {
        match args[index].to_ascii_uppercase().as_str() {
            "MATCH" => {
                let raw = args
                    .get(index + 1)
                    .ok_or_else(|| AppError::Validation("SCAN MATCH requires a pattern".into()))?;
                pattern = Some(checked_pattern(raw)?);
                index += 2;
            }
            "COUNT" => {
                let raw = args
                    .get(index + 1)
                    .ok_or_else(|| AppError::Validation("SCAN COUNT requires n".into()))?;
                count = Some(bounded_limit(Some(parse_u32(raw, "SCAN COUNT")?)));
                index += 2;
            }
            other => {
                return Err(AppError::Unsupported(format!(
                    "SCAN option '{other}' is not supported in the bounded Redis command slice"
                )));
            }
        }
    }
    Ok(RedisCommand::Scan {
        cursor: checked_pattern(&args[0])?,
        pattern,
        count,
    })
}

fn parse_keys(args: &[String]) -> Result<RedisCommand, AppError> {
    require_arg_count(args, 1, "KEYS")?;
    Ok(RedisCommand::Keys {
        pattern: checked_pattern(&args[0])?,
    })
}

pub(super) fn range_limit(start: i64, stop: i64) -> Result<u32, AppError> {
    if start < 0 || stop < start {
        return Err(AppError::Unsupported(
            "Redis command editor requires non-negative bounded ranges".into(),
        ));
    }
    Ok(bounded_limit(Some((stop - start + 1) as u32)))
}

fn parse_lrange(args: &[String]) -> Result<RedisCommand, AppError> {
    require_arg_count(args, 3, "LRANGE")?;
    Ok(RedisCommand::LRange {
        key: checked_key(&args[0])?,
        start: parse_i64(&args[1], "LRANGE start")?,
        stop: parse_i64(&args[2], "LRANGE stop")?,
    })
}

fn parse_zrange(args: &[String]) -> Result<RedisCommand, AppError> {
    if args.len() != 3 && args.len() != 4 {
        return Err(AppError::Validation(
            "ZRANGE requires key, start, stop, and optional WITHSCORES".into(),
        ));
    }
    let with_scores = args
        .get(3)
        .map(|arg| arg.eq_ignore_ascii_case("WITHSCORES"))
        .unwrap_or(false);
    if args.len() == 4 && !with_scores {
        return Err(AppError::Validation(
            "ZRANGE only supports WITHSCORES as its optional argument".into(),
        ));
    }
    Ok(RedisCommand::ZRange {
        key: checked_key(&args[0])?,
        start: parse_i64(&args[1], "ZRANGE start")?,
        stop: parse_i64(&args[2], "ZRANGE stop")?,
        with_scores,
    })
}

fn parse_xrange(args: &[String]) -> Result<RedisCommand, AppError> {
    if args.len() != 3 && args.len() != 5 {
        return Err(AppError::Validation(
            "XRANGE requires key, start, end, and optional COUNT n".into(),
        ));
    }
    let count = if args.len() == 5 {
        if !args[3].eq_ignore_ascii_case("COUNT") {
            return Err(AppError::Validation(
                "XRANGE only supports COUNT as its optional argument".into(),
            ));
        }
        Some(bounded_limit(Some(parse_u32(&args[4], "XRANGE COUNT")?)))
    } else {
        None
    };
    Ok(RedisCommand::XRange {
        key: checked_key(&args[0])?,
        start: args[1].clone(),
        end: args[2].clone(),
        count,
    })
}

fn parse_exists(args: &[String]) -> Result<RedisCommand, AppError> {
    if args.is_empty() {
        return Err(AppError::Validation(
            "EXISTS requires at least one key".into(),
        ));
    }
    Ok(RedisCommand::Exists {
        keys: args
            .iter()
            .map(|key| checked_key(key))
            .collect::<Result<_, _>>()?,
    })
}

fn parse_set(args: &[String]) -> Result<RedisCommand, AppError> {
    if args.len() < 2 {
        return Err(AppError::Validation("SET requires key and value".into()));
    }
    let mut ttl_seconds = None;
    let mut index = 2;
    while index < args.len() {
        match args[index].to_ascii_uppercase().as_str() {
            "EX" => {
                let raw = args.get(index + 1).ok_or_else(|| {
                    AppError::Validation("SET EX requires a seconds argument".into())
                })?;
                ttl_seconds = Some(parse_u64(raw, "SET EX seconds")?);
                index += 2;
            }
            "NX" | "XX" => {
                return Err(AppError::Unsupported(
                    "SET NX/XX safety options are routed to typed KV write controls".into(),
                ));
            }
            other => {
                return Err(AppError::Unsupported(format!(
                    "SET option '{other}' is not supported in the bounded Redis command slice"
                )));
            }
        }
    }
    Ok(RedisCommand::Set {
        key: checked_key(&args[0])?,
        value: args[1].clone(),
        ttl_seconds,
    })
}

fn parse_hset(args: &[String]) -> Result<RedisCommand, AppError> {
    require_arg_count(args, 3, "HSET")?;
    Ok(RedisCommand::HSet {
        key: checked_key(&args[0])?,
        field: args[1].clone(),
        value: args[2].clone(),
    })
}

/// Shared parser for `<VERB> key member [member...]` (HDEL / SREM / ZREM):
/// at least one target member after the key.
fn parse_members(
    args: &[String],
    command: &str,
    build: impl Fn(String, Vec<String>) -> RedisCommand,
) -> Result<RedisCommand, AppError> {
    if args.len() < 2 {
        return Err(AppError::Validation(format!(
            "{command} requires key and member(s)"
        )));
    }
    Ok(build(checked_key(&args[0])?, args[1..].to_vec()))
}

fn parse_lset(args: &[String]) -> Result<RedisCommand, AppError> {
    require_arg_count(args, 3, "LSET")?;
    Ok(RedisCommand::LSet {
        key: checked_key(&args[0])?,
        index: parse_i64(&args[1], "LSET index")?,
        value: args[2].clone(),
    })
}

fn parse_lrem(args: &[String]) -> Result<RedisCommand, AppError> {
    require_arg_count(args, 3, "LREM")?;
    Ok(RedisCommand::LRem {
        key: checked_key(&args[0])?,
        // count sign is meaningful: 0 = all, >0 head→tail, <0 tail→head.
        count: parse_i64(&args[1], "LREM count")?,
        value: args[2].clone(),
    })
}

fn parse_list_push(command: &str, args: &[String]) -> Result<RedisCommand, AppError> {
    if args.len() < 2 {
        return Err(AppError::Validation(format!(
            "{command} requires key and value(s)"
        )));
    }
    let key = checked_key(&args[0])?;
    let values = args[1..].to_vec();
    if command == "LPUSH" {
        Ok(RedisCommand::LPush { key, values })
    } else {
        Ok(RedisCommand::RPush { key, values })
    }
}

fn parse_sadd(args: &[String]) -> Result<RedisCommand, AppError> {
    if args.len() < 2 {
        return Err(AppError::Validation(
            "SADD requires key and member(s)".into(),
        ));
    }
    Ok(RedisCommand::SAdd {
        key: checked_key(&args[0])?,
        members: args[1..].to_vec(),
    })
}

fn parse_zadd(args: &[String]) -> Result<RedisCommand, AppError> {
    require_arg_count(args, 3, "ZADD")?;
    Ok(RedisCommand::ZAdd {
        key: checked_key(&args[0])?,
        score: parse_f64(&args[1], "ZADD score")?,
        member: args[2].clone(),
    })
}

/// `JSON.SET key $ <json>` — bounded to the root path `$` so this ReJSON write
/// can only overwrite the WHOLE value (last-writer-wins), never a surgical
/// sub-path patch. That keeps the write auditable: the value the user confirmed
/// in the Safe Mode preview is exactly the value that lands (#PR3).
fn parse_json_set(args: &[String]) -> Result<RedisCommand, AppError> {
    require_arg_count(args, 3, "JSON.SET")?;
    if args[1] != "$" {
        return Err(AppError::Unsupported(
            "JSON.SET is bounded to the root path '$' (whole-value overwrite)".into(),
        ));
    }
    Ok(RedisCommand::JsonSet {
        key: checked_key(&args[0])?,
        path: args[1].clone(),
        value: args[2].clone(),
    })
}

fn parse_expire(args: &[String]) -> Result<RedisCommand, AppError> {
    require_arg_count(args, 2, "EXPIRE")?;
    let seconds = parse_u64(&args[1], "EXPIRE seconds")?;
    if seconds == 0 {
        return Err(AppError::Validation(
            "EXPIRE seconds must be greater than zero".into(),
        ));
    }
    Ok(RedisCommand::Expire {
        key: checked_key(&args[0])?,
        seconds,
    })
}

/// `XADD key <id> field value [field value ...]` — append one entry to an
/// append-only stream. The id is passed through verbatim so `*` (server-assigned
/// id) and an explicit id both work; the field/value operands must form balanced
/// pairs (at least one). Every token is later `.arg()`-encoded individually, so a
/// value containing spaces can never leak into extra command tokens (#1683 PR5b).
fn parse_xadd(args: &[String]) -> Result<RedisCommand, AppError> {
    if args.len() < 4 {
        return Err(AppError::Validation(
            "XADD requires key, id, and at least one field-value pair".into(),
        ));
    }
    let pairs = &args[2..];
    if !pairs.len().is_multiple_of(2) {
        return Err(AppError::Validation(
            "XADD field-value pairs must be balanced".into(),
        ));
    }
    Ok(RedisCommand::XAdd {
        key: checked_key(&args[0])?,
        id: args[1].clone(),
        fields: pairs
            .chunks_exact(2)
            .map(|pair| (pair[0].clone(), pair[1].clone()))
            .collect(),
    })
}

/// `XTRIM key MAXLEN <count>` — bound to the single MAXLEN exact-count strategy.
/// MINID / approximate `~` / LIMIT are outside the allowlist so a malicious
/// option string can never widen the command into a different trim (#1683 PR5b).
fn parse_xtrim(args: &[String]) -> Result<RedisCommand, AppError> {
    require_arg_count(args, 3, "XTRIM")?;
    if !args[1].eq_ignore_ascii_case("MAXLEN") {
        return Err(AppError::Unsupported(
            "XTRIM is bounded to the MAXLEN <count> strategy".into(),
        ));
    }
    Ok(RedisCommand::XTrim {
        key: checked_key(&args[0])?,
        maxlen: parse_u64(&args[2], "XTRIM MAXLEN count")?,
    })
}

fn reject_command_family(command: &str) -> Result<(), AppError> {
    const UNSUPPORTED_PREFIXES: &[&str] = &[
        "ACL",
        "BG",
        "CLIENT",
        "CLUSTER",
        "CONFIG",
        "DEBUG",
        "EVAL",
        "EVALSHA",
        "FAILOVER",
        "FLUSH",
        "FUNCTION",
        "LATENCY",
        "MEMORY",
        "MODULE",
        "MONITOR",
        "MIGRATE",
        "PUBSUB",
        "SCRIPT",
        "SHUTDOWN",
        "SLAVEOF",
        "REPLICAOF",
        "XGROUP",
        "XREADGROUP",
    ];
    const DESTRUCTIVE_WITHOUT_TYPED_CONFIRM: &[&str] = &["UNLINK", "RENAME"];
    if UNSUPPORTED_PREFIXES
        .iter()
        .any(|prefix| command.starts_with(prefix))
    {
        return Err(AppError::Unsupported(format!(
            "Redis command family '{command}' is outside the bounded runtime slice"
        )));
    }
    if DESTRUCTIVE_WITHOUT_TYPED_CONFIRM
        .iter()
        .any(|prefix| command.starts_with(prefix))
    {
        return Err(AppError::Unsupported(format!(
            "Redis command '{command}' requires typed confirmation and is routed to the safety-policy follow-up"
        )));
    }
    Ok(())
}

fn tokenize(input: &str) -> Result<Vec<String>, AppError> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match (quote, ch) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), '\\') => {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            (Some(_), c) => current.push(c),
            (None, '\'' | '"') => quote = Some(ch),
            (None, c) if c.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            (None, c) => current.push(c),
        }
    }
    if let Some(q) = quote {
        return Err(AppError::Validation(format!(
            "Unclosed Redis command quote: {q}"
        )));
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

fn one_key(args: &[String], command: &str) -> Result<String, AppError> {
    require_arg_count(args, 1, command)?;
    checked_key(&args[0])
}

fn checked_key(key: &str) -> Result<String, AppError> {
    validate_key(key)?;
    Ok(key.to_string())
}

fn checked_pattern(pattern: &str) -> Result<String, AppError> {
    if pattern.is_empty() {
        return Err(AppError::Validation("Redis pattern is required".into()));
    }
    Ok(pattern.to_string())
}

fn require_arg_count(args: &[String], expected: usize, command: &str) -> Result<(), AppError> {
    if args.len() != expected {
        return Err(AppError::Validation(format!(
            "{command} requires {expected} argument(s)"
        )));
    }
    Ok(())
}

fn parse_i64(raw: &str, label: &str) -> Result<i64, AppError> {
    raw.parse::<i64>()
        .map_err(|_| AppError::Validation(format!("{label} must be an integer")))
}

fn parse_u32(raw: &str, label: &str) -> Result<u32, AppError> {
    raw.parse::<u32>()
        .map_err(|_| AppError::Validation(format!("{label} must be a positive integer")))
}

fn parse_u64(raw: &str, label: &str) -> Result<u64, AppError> {
    raw.parse::<u64>()
        .map_err(|_| AppError::Validation(format!("{label} must be a positive integer")))
}

fn parse_f64(raw: &str, label: &str) -> Result<f64, AppError> {
    raw.parse::<f64>()
        .map_err(|_| AppError::Validation(format!("{label} must be a number")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_accepts_bounded_read_write_ttl_and_stream_commands() {
        let read = parse_redis_command("GET session:1").unwrap();
        assert!(matches!(read, RedisCommand::Get { .. }));
        assert_eq!(read.effect(), RedisCommandEffect::Read);

        let write = parse_redis_command("HSET profile:1 name Ada").unwrap();
        assert!(matches!(write, RedisCommand::HSet { .. }));
        assert_eq!(write.effect(), RedisCommandEffect::Write);

        let ttl = parse_redis_command("EXPIRE session:1 60").unwrap();
        assert!(matches!(ttl, RedisCommand::Expire { .. }));
        assert_eq!(ttl.effect(), RedisCommandEffect::Ttl);

        let stream = parse_redis_command("XRANGE events - + COUNT 25").unwrap();
        assert!(matches!(
            stream,
            RedisCommand::XRange {
                count: Some(25),
                ..
            }
        ));
        assert_eq!(stream.effect(), RedisCommandEffect::Stream);

        assert!(matches!(
            parse_redis_command("XRANGE events - + COUNT 999999").unwrap(),
            RedisCommand::XRange {
                count: Some(super::super::helpers::MAX_SCAN_LIMIT),
                ..
            }
        ));
    }

    #[test]
    fn parser_accepts_scan_and_keys_commands() {
        let scan = parse_redis_command("SCAN 0 MATCH profile:* COUNT 25").unwrap();
        assert!(matches!(
            scan,
            RedisCommand::Scan {
                ref cursor,
                pattern: Some(ref pattern),
                count: Some(25),
            } if cursor == "0" && pattern == "profile:*"
        ));
        assert_eq!(scan.effect(), RedisCommandEffect::Read);

        let keys = parse_redis_command("KEYS *").unwrap();
        assert!(matches!(
            keys,
            RedisCommand::Keys { ref pattern } if pattern == "*"
        ));
        assert_eq!(keys.effect(), RedisCommandEffect::Read);
    }

    #[test]
    fn parser_accepts_element_crud_commands() {
        // #1466 — per-element hash/list/set/zSet write + removal verbs.
        let hdel = parse_redis_command("HDEL profile:1 email name").unwrap();
        assert_eq!(
            hdel,
            RedisCommand::HDel {
                key: "profile:1".into(),
                fields: vec!["email".into(), "name".into()],
            }
        );

        let lset = parse_redis_command("LSET queue -1 done").unwrap();
        assert_eq!(
            lset,
            RedisCommand::LSet {
                key: "queue".into(),
                index: -1,
                value: "done".into(),
            }
        );
        assert_eq!(lset.effect(), RedisCommandEffect::Write);

        let lrem = parse_redis_command("LREM queue 0 stale").unwrap();
        assert_eq!(
            lrem,
            RedisCommand::LRem {
                key: "queue".into(),
                count: 0,
                value: "stale".into(),
            }
        );

        assert!(matches!(
            parse_redis_command("SREM tags beta").unwrap(),
            RedisCommand::SRem { .. }
        ));
        assert!(matches!(
            parse_redis_command("ZREM board ada").unwrap(),
            RedisCommand::ZRem { .. }
        ));

        // Element removals are destructive but never require a typed key
        // confirmation, even though removing the last element drops the key
        // (Redis GCs the now-empty collection).
        for command in ["HDEL h f", "LREM l 1 v", "SREM s m", "ZREM z m"] {
            let parsed = parse_redis_command(command).unwrap();
            assert_eq!(parsed.effect(), RedisCommandEffect::Destructive);
            assert_eq!(parsed.required_confirmation_key(), None);
        }
    }

    #[test]
    fn parser_rejects_malformed_element_crud_commands() {
        for command in [
            "HDEL onlykey",
            "SREM onlykey",
            "ZREM onlykey",
            "LSET key notanint value",
            "LREM key notanint value",
            "LSET key 0",
        ] {
            assert!(
                matches!(parse_redis_command(command), Err(AppError::Validation(_))),
                "expected validation error for {command}"
            );
        }
    }

    #[test]
    fn parser_accepts_json_set_whole_value_overwrite() {
        // PR3 — ReJSON write. Bounded to root path `$`; the quoted JSON payload
        // (spaces + inner quotes) round-trips through the tokenizer intact.
        let parsed =
            parse_redis_command("JSON.SET doc:1 $ \"{\\\"name\\\":\\\"Ada Lovelace\\\"}\"")
                .unwrap();
        assert_eq!(
            parsed,
            RedisCommand::JsonSet {
                key: "doc:1".into(),
                path: "$".into(),
                value: "{\"name\":\"Ada Lovelace\"}".into(),
            }
        );
        // Whole-slot overwrite is a non-destructive write, no typed confirm key.
        assert_eq!(parsed.effect(), RedisCommandEffect::Write);
        assert_eq!(parsed.required_confirmation_key(), None);
    }

    #[test]
    fn parser_rejects_non_root_and_malformed_json_set() {
        // Sub-path patches are outside the bounded whole-value overwrite slice.
        assert!(matches!(
            parse_redis_command("JSON.SET doc:1 $.name \"x\""),
            Err(AppError::Unsupported(_))
        ));
        // Missing the value operand.
        assert!(matches!(
            parse_redis_command("JSON.SET doc:1 $"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn parser_accepts_stream_mutation_commands() {
        // #1683 PR5b — append-only stream write surface: XADD append (Write),
        // XDEL entry drop + XTRIM MAXLEN trim (Destructive).
        let xadd = parse_redis_command("XADD events * type login user ada").unwrap();
        assert_eq!(
            xadd,
            RedisCommand::XAdd {
                key: "events".into(),
                id: "*".into(),
                fields: vec![
                    ("type".into(), "login".into()),
                    ("user".into(), "ada".into()),
                ],
            }
        );
        // Append is a non-destructive write with no typed-key confirmation.
        assert_eq!(xadd.effect(), RedisCommandEffect::Write);
        assert_eq!(xadd.required_confirmation_key(), None);

        // An explicit entry id is accepted verbatim alongside the `*` default.
        assert!(matches!(
            parse_redis_command("XADD events 1526919030474-0 k v").unwrap(),
            RedisCommand::XAdd { id, .. } if id == "1526919030474-0"
        ));

        let xdel = parse_redis_command("XDEL events 1-1 1-2").unwrap();
        assert_eq!(
            xdel,
            RedisCommand::XDel {
                key: "events".into(),
                ids: vec!["1-1".into(), "1-2".into()],
            }
        );

        let xtrim = parse_redis_command("XTRIM events MAXLEN 100").unwrap();
        assert_eq!(
            xtrim,
            RedisCommand::XTrim {
                key: "events".into(),
                maxlen: 100,
            }
        );

        // Both removals are destructive without a typed key confirmation.
        for command in ["XDEL events 1-1", "XTRIM events MAXLEN 0"] {
            let parsed = parse_redis_command(command).unwrap();
            assert_eq!(parsed.effect(), RedisCommandEffect::Destructive);
            assert_eq!(parsed.required_confirmation_key(), None);
        }
    }

    #[test]
    fn parser_rejects_malformed_and_out_of_allowlist_stream_mutations() {
        for command in [
            "XADD events *",             // no field-value pair
            "XADD events * onlyfield",   // unbalanced pair
            "XADD events * a b c",       // trailing unbalanced token
            "XDEL events",               // no entry id
            "XTRIM events MINID 1-1",    // strategy outside the MAXLEN allowlist
            "XTRIM events MAXLEN ~ 100", // approximate arg widens arity
            "XTRIM events MAXLEN notint",
            "XTRIM events",
        ] {
            assert!(
                parse_redis_command(command).is_err(),
                "expected rejection for {command}"
            );
        }
    }

    #[test]
    fn stream_mutation_quoted_operands_never_leak_extra_tokens() {
        // Injection guard — a quoted value containing whitespace and a verb-like
        // word round-trips through the tokenizer as ONE field value, so it can
        // never split into extra command tokens (each token is `.arg()`-encoded
        // individually downstream).
        let parsed = parse_redis_command("XADD events * note \"drop table; FLUSHALL x\"").unwrap();
        assert_eq!(
            parsed,
            RedisCommand::XAdd {
                key: "events".into(),
                id: "*".into(),
                fields: vec![("note".into(), "drop table; FLUSHALL x".into())],
            }
        );
    }

    #[test]
    fn parser_classifies_typed_confirmation_commands() {
        let delete = parse_redis_command("DEL session:1").unwrap();
        assert_eq!(delete.effect(), RedisCommandEffect::Destructive);
        assert_eq!(delete.required_confirmation_key(), Some("session:1"));

        let persist = parse_redis_command("PERSIST session:1").unwrap();
        assert_eq!(persist.effect(), RedisCommandEffect::Ttl);
        assert_eq!(persist.required_confirmation_key(), Some("session:1"));
    }

    #[test]
    fn parser_rejects_unsupported_and_destructive_command_families() {
        assert!(matches!(
            parse_redis_command("FLUSHDB"),
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            parse_redis_command("UNLINK session:1"),
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            parse_redis_command("CLUSTER INFO"),
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            parse_redis_command("PUBSUB CHANNELS"),
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            parse_redis_command("MODULE LIST"),
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            parse_redis_command("XGROUP CREATE stream group $"),
            Err(AppError::Unsupported(_))
        ));
        assert!(matches!(
            parse_redis_command("SET session:1 Ada NX"),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn tokenizer_supports_quoted_values_without_full_shell_semantics() {
        let parsed = parse_redis_command("SET session:1 \"Ada Lovelace\" EX 30").unwrap();
        assert_eq!(
            parsed,
            RedisCommand::Set {
                key: "session:1".into(),
                value: "Ada Lovelace".into(),
                ttl_seconds: Some(30),
            }
        );
        assert!(matches!(
            parse_redis_command("SET session:1 \"broken"),
            Err(AppError::Validation(_))
        ));
    }
}
