/**
 * `errors` 네임스페이스 — 드라이버 에러 힌팅 (issue #1056).
 *
 * `classifyDriverError` (src/lib/errors/driverErrorHints.ts) 가 반환하는
 * `errors:hint.<category>.title` / `.hint` 키를 제공한다. 톤 표준은
 * KeyringFallbackToast (상황 설명 + 행동 지침). 원문은 각 표면이 detail 로
 * 보존하므로 여기서는 요약 + 행동만 담는다.
 *
 * 키 네이밍은 #1074(i18n) 선행 조율에 맞춰 보수적으로 유지한다.
 */

export const en = {
  hint: {
    connectionRefused: {
      title: "Can't reach the database server",
      hint: "The connection was refused. Check that the host and port are correct and that the database is running and accepting connections.",
    },
    authFailed: {
      title: "Authentication failed",
      hint: "The server rejected your credentials. Verify the username and password, and confirm the account can access this database.",
    },
    timeout: {
      title: "Connection timed out",
      hint: "The server didn't respond in time. Check your network, VPN, or firewall, and confirm the host and port are reachable.",
    },
    unknownHost: {
      title: "Host not found",
      hint: "The hostname couldn't be resolved. Check the host for typos and confirm DNS or your VPN can reach it.",
    },
    permissionDenied: {
      title: "Permission denied",
      hint: "You're connected, but your account lacks permission for this operation. Ask a database administrator to grant the required privileges.",
    },
    introspectionFailed: {
      title: "Couldn't read the result metadata",
      hint: "The database — or a proxy or connection pooler in front of it — returned an unexpected response while describing this query. Try connecting directly instead of through the proxy, or confirm it fully supports your database's wire protocol.",
    },
  },
} as const;

export const ko = {
  hint: {
    connectionRefused: {
      title: "데이터베이스 서버에 연결할 수 없습니다",
      hint: "연결이 거부되었습니다. 호스트와 포트가 올바른지, 데이터베이스가 실행 중이며 연결을 받고 있는지 확인하세요.",
    },
    authFailed: {
      title: "인증에 실패했습니다",
      hint: "서버가 자격 증명을 거부했습니다. 사용자명과 비밀번호를 확인하고, 해당 계정이 이 데이터베이스에 접근할 수 있는지 확인하세요.",
    },
    timeout: {
      title: "연결 시간이 초과되었습니다",
      hint: "서버가 제때 응답하지 않았습니다. 네트워크, VPN, 방화벽을 확인하고 호스트와 포트에 도달 가능한지 확인하세요.",
    },
    unknownHost: {
      title: "호스트를 찾을 수 없습니다",
      hint: "호스트 이름을 해석할 수 없습니다. 호스트에 오타가 없는지 확인하고 DNS 또는 VPN 으로 도달 가능한지 확인하세요.",
    },
    permissionDenied: {
      title: "권한이 거부되었습니다",
      hint: "연결은 되었으나 계정에 이 작업 권한이 없습니다. 데이터베이스 관리자에게 필요한 권한을 요청하세요.",
    },
    introspectionFailed: {
      title: "결과 메타데이터를 읽지 못했습니다",
      hint: "데이터베이스 또는 앞단의 프록시·커넥션 풀러가 이 쿼리를 설명(describe)하는 중 예기치 않은 응답을 반환했습니다. 프록시를 거치지 말고 직접 연결해 보거나, 해당 프록시가 데이터베이스 프로토콜을 완전히 지원하는지 확인하세요.",
    },
  },
} as const;
