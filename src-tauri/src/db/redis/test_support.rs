use crate::models::{ConnectionConfig, DatabaseType};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub(super) fn runtime_config(port: u16, database: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: "r-live".into(),
        name: "redis-runtime".into(),
        db_type: DatabaseType::Redis,
        host: "127.0.0.1".into(),
        port,
        user: String::new(),
        password: String::new(),
        database: database.into(),
        read_only: false,
        group_id: None,
        color: None,
        connection_timeout: None,
        keep_alive_interval: None,
        environment: None,
        auth_source: None,
        replica_set: None,
        tls_enabled: None,
        trust_server_certificate: None,
    }
}

pub(super) async fn spawn_redis_catalog_stub() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind redis stub");
    let port = listener.local_addr().expect("redis stub addr").port();
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(handle_redis_stub_connection(stream));
        }
    });
    port
}

async fn handle_redis_stub_connection(mut stream: tokio::net::TcpStream) {
    let mut buffer = Vec::new();
    let mut scratch = [0_u8; 1024];
    loop {
        let Ok(read) = stream.read(&mut scratch).await else {
            break;
        };
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&scratch[..read]);
        while let Some(command) = parse_resp_command(&mut buffer) {
            let response = redis_stub_response(&command);
            if stream.write_all(&response).await.is_err() {
                return;
            }
        }
    }
}

fn parse_resp_command(buffer: &mut Vec<u8>) -> Option<Vec<String>> {
    if buffer.first().copied()? != b'*' {
        buffer.clear();
        return None;
    }
    let mut offset = 1;
    let count_end = find_crlf(buffer, offset)?;
    let count = std::str::from_utf8(&buffer[offset..count_end])
        .ok()?
        .parse::<usize>()
        .ok()?;
    offset = count_end + 2;
    let mut parts = Vec::with_capacity(count);
    for _ in 0..count {
        if buffer.get(offset).copied()? != b'$' {
            buffer.clear();
            return None;
        }
        offset += 1;
        let len_end = find_crlf(buffer, offset)?;
        let len = std::str::from_utf8(&buffer[offset..len_end])
            .ok()?
            .parse::<usize>()
            .ok()?;
        offset = len_end + 2;
        if buffer.len() < offset + len + 2 {
            return None;
        }
        let part = String::from_utf8_lossy(&buffer[offset..offset + len]).to_string();
        parts.push(part);
        offset += len + 2;
    }
    buffer.drain(..offset);
    Some(parts)
}

fn find_crlf(buffer: &[u8], start: usize) -> Option<usize> {
    buffer[start..]
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|relative| start + relative)
}

fn redis_stub_response(command: &[String]) -> Vec<u8> {
    let text = match command.first().map(|value| value.to_ascii_uppercase()).as_deref() {
        Some("CLIENT") => "+OK\r\n",
        Some("PING") => "+PONG\r\n",
        Some("CONFIG") => "*2\r\n$9\r\ndatabases\r\n$1\r\n4\r\n",
        Some("INFO") => {
            "$77\r\n# Keyspace\r\ndb0:keys=2,expires=1,avg_ttl=42\r\ndb2:keys=1,expires=0,avg_ttl=0\r\n\r\n"
        }
        Some("SELECT") => "+OK\r\n",
        Some("SCAN") => "*2\r\n$1\r\n0\r\n*2\r\n$5\r\nalpha\r\n$4\r\nbeta\r\n",
        Some("KEYS") => "*2\r\n$5\r\nalpha\r\n$4\r\nbeta\r\n",
        Some("TYPE") => return type_response(command.get(1).map(String::as_str)),
        Some("EXISTS") => return exists_response(command.get(1).map(String::as_str)),
        Some("TTL") => return ttl_response(command.get(1).map(String::as_str)),
        Some("STRLEN") => ":5\r\n",
        Some("LLEN") | Some("SCARD") | Some("ZCARD") | Some("HLEN") => ":2\r\n",
        Some("XLEN") => ":1\r\n",
        Some("MEMORY") if command.get(2).is_some_and(|key| key == "alpha") => ":64\r\n",
        Some("MEMORY") if command.get(2).is_some_and(|key| key == "beta") => ":96\r\n",
        Some("MEMORY") => "$-1\r\n",
        Some("GET") if command.get(1).is_some_and(|key| key == "binary") => {
            return b"$3\r\n\xff\0A\r\n".to_vec();
        }
        Some("GET") => "$5\r\nhello\r\n",
        Some("LRANGE") => "*2\r\n$1\r\na\r\n$1\r\nb\r\n",
        Some("SSCAN") => "*2\r\n$1\r\n0\r\n*2\r\n$1\r\na\r\n$1\r\nb\r\n",
        Some("ZRANGE") => "*4\r\n$1\r\na\r\n$3\r\n1.5\r\n$1\r\nb\r\n$3\r\n2.5\r\n",
        Some("HSCAN") => "*2\r\n$1\r\n0\r\n*2\r\n$4\r\nname\r\n$3\r\nAda\r\n",
        Some("JSON.GET") => "$11\r\n{\"ok\":true}\r\n",
        Some("XRANGE") => "*1\r\n*2\r\n$3\r\n1-0\r\n*2\r\n$4\r\ntype\r\n$5\r\nlogin\r\n",
        Some("HSET") => ":1\r\n",
        Some("LPUSH") | Some("RPUSH") => ":2\r\n",
        Some("SADD") | Some("ZADD") => ":1\r\n",
        Some("SET")
            if command.get(1).is_some_and(|key| key == "alpha")
                && command.iter().any(|part| part.eq_ignore_ascii_case("NX")) =>
        {
            "$-1\r\n"
        }
        Some("SET") => "+OK\r\n",
        Some("DEL") | Some("EXPIRE") | Some("PERSIST") => ":1\r\n",
        _ => "-ERR unsupported test command\r\n",
    };
    text.as_bytes().to_vec()
}

fn type_response(key: Option<&str>) -> Vec<u8> {
    let key_type = match key {
        Some("alpha" | "binary" | "mut:string") => "string",
        Some("beta") => "hash",
        Some("list") => "list",
        Some("set") => "set",
        Some("zset") => "zset",
        Some("stream" | "events") => "stream",
        Some("json") => "ReJSON-RL",
        Some("missing") => "none",
        _ => "string",
    };
    format!("+{key_type}\r\n").into_bytes()
}

fn exists_response(key: Option<&str>) -> Vec<u8> {
    let exists = match key {
        Some("missing") => 0,
        _ => 1,
    };
    format!(":{exists}\r\n").into_bytes()
}

fn ttl_response(key: Option<&str>) -> Vec<u8> {
    let ttl = match key {
        Some("alpha" | "mut:string") => 30,
        Some("missing") => -2,
        _ => -1,
    };
    format!(":{ttl}\r\n").into_bytes()
}
