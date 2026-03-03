#! /bin/bash

noona_kavita_bootstrap_log() {
    echo "[noona-kavita-bootstrap] $*"
}

noona_kavita_json_escape() {
    local value="${1-}"
    value=${value//\\/\\\\}
    value=${value//\"/\\\"}
    value=${value//$'\n'/\\n}
    value=${value//$'\r'/\\r}
    value=${value//$'\t'/\\t}
    printf '%s' "$value"
}

noona_kavita_post_json() {
    local url="$1"
    local payload="$2"
    local body_file="$3"
    local status

    status=$(curl -sS -o "$body_file" -w "%{http_code}" \
        -H "Content-Type: application/json" \
        -X POST \
        --data "$payload" \
        "$url")
    local curl_status=$?
    if [ "$curl_status" -ne 0 ]; then
        printf '000'
        return "$curl_status"
    fi

    printf '%s' "$status"
}

noona_kavita_wait_for_health() {
    local max_attempts=120
    local attempt=1

    while [ "$attempt" -le "$max_attempts" ]; do
        if curl -fsS http://127.0.0.1:5000/api/health >/dev/null 2>&1; then
            return 0
        fi

        sleep 2
        attempt=$((attempt + 1))
    done

    noona_kavita_bootstrap_log "timed out waiting for Kavita to become healthy"
    return 1
}

start_noona_kavita_admin_bootstrap() {
    local username="${KAVITA_ADMIN_USERNAME:-}"
    local email="${KAVITA_ADMIN_EMAIL:-}"
    local password="${KAVITA_ADMIN_PASSWORD:-}"

    if [ -z "$username" ] && [ -z "$email" ] && [ -z "$password" ]; then
        return 0
    fi

    if [ -z "$username" ] || [ -z "$email" ] || [ -z "$password" ]; then
        noona_kavita_bootstrap_log "skipping bootstrap because KAVITA_ADMIN_USERNAME, KAVITA_ADMIN_EMAIL, and KAVITA_ADMIN_PASSWORD must all be set"
        return 0
    fi

    noona_kavita_bootstrap_log "starting managed first-admin bootstrap for ${username}"

    (
        set +e
        register_body=""
        login_body=""
        trap 'rm -f "$register_body" "$login_body"' EXIT

        if ! noona_kavita_wait_for_health; then
            exit 0
        fi

        register_body=$(mktemp)
        login_body=$(mktemp)

        register_payload=$(printf '{"username":"%s","email":"%s","password":"%s"}' \
            "$(noona_kavita_json_escape "$username")" \
            "$(noona_kavita_json_escape "$email")" \
            "$(noona_kavita_json_escape "$password")")
        register_status=$(noona_kavita_post_json "http://127.0.0.1:5000/api/Account/register" "$register_payload" "$register_body")

        if [ "$register_status" = "200" ]; then
            noona_kavita_bootstrap_log "registered first admin account ${username}"
            exit 0
        fi

        login_payload=$(printf '{"username":"%s","password":"%s"}' \
            "$(noona_kavita_json_escape "$username")" \
            "$(noona_kavita_json_escape "$password")")
        login_status=$(noona_kavita_post_json "http://127.0.0.1:5000/api/Account/login" "$login_payload" "$login_body")

        if [ "$login_status" = "200" ]; then
            noona_kavita_bootstrap_log "reused existing admin account ${username}"
            exit 0
        fi

        noona_kavita_bootstrap_log "failed to provision admin account ${username} (register=${register_status}, login=${login_status})"
    ) &
}
