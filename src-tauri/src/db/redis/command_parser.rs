use crate::error::AppError;

use super::helpers::{bounded_limit, validate_key};

#[derive(Debug, Clone, PartialEq)]
pub(super) enum RedisCommand {
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
    LPush {
        key: String,
        values: Vec<String>,
    },
    RPush {
        key: String,
        values: Vec<String>,
    },
    SAdd {
        key: String,
        members: Vec<String>,
    },
    ZAdd {
        key: String,
        score: f64,
        member: String,
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
            RedisCommand::Get { .. }
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
            | RedisCommand::SAdd { .. }
            | RedisCommand::ZAdd { .. } => RedisCommandEffect::Write,
            RedisCommand::Ttl { .. }
            | RedisCommand::Expire { .. }
            | RedisCommand::Persist { .. } => RedisCommandEffect::Ttl,
            RedisCommand::XRange { .. } => RedisCommandEffect::Stream,
            RedisCommand::Del { .. } => RedisCommandEffect::Destructive,
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
        "LPUSH" | "RPUSH" => parse_list_push(&upper, args),
        "SADD" => parse_sadd(args),
        "ZADD" => parse_zadd(args),
        "EXPIRE" => parse_expire(args),
        "PERSIST" => Ok(RedisCommand::Persist {
            key: one_key(args, "PERSIST")?,
        }),
        "DEL" => Ok(RedisCommand::Del {
            key: one_key(args, "DEL")?,
        }),
        _ => Err(AppError::Unsupported(format!(
            "Redis command '{upper}' is not in the bounded command allowlist"
        ))),
    }
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
