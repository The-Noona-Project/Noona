param(
    [string]$NetworkName = $env:NOONA_NETWORK,
    [string]$ContainerName = $env:WARDEN_CONTAINER_NAME,
    [string]$WardenImage = $env:WARDEN_IMAGE,
    [string]$DebugMode = $env:DEBUG,
    [string]$DockerSocketPath = $env:DOCKER_SOCK_PATH,
    [string]$WardenPort = $env:WARDEN_PORT
)

if (-not $NetworkName) { $NetworkName = 'noona-network' }
if (-not $ContainerName) { $ContainerName = 'noona-warden' }
if (-not $WardenImage) { $WardenImage = 'captainpax/noona-warden:latest' }
if (-not $DebugMode) { $DebugMode = 'false' }
if ($WardenPort) { $WardenPort = [int]$WardenPort } else { $WardenPort = 4001 }

if (-not $DockerSocketPath) {
    if ($IsWindows) {
        $DockerSocketPath = '//./pipe/docker_engine'
    }
    else {
        $DockerSocketPath = '/var/run/docker.sock'
    }
}

$existingNetwork = docker network ls --format '{{.Name}}' | Where-Object { $_ -eq $NetworkName }
if (-not $existingNetwork) {
    Write-Host "Creating Docker network '$NetworkName'..."
    docker network create $NetworkName | Out-Null
}

Write-Host "Starting $ContainerName on port $WardenPort using $WardenImage..."
& docker run -d --rm `
    --name $ContainerName `
    --network $NetworkName `
    -p "$WardenPort`:$WardenPort" `
    -v "$DockerSocketPath`:/var/run/docker.sock" `
    -e "DEBUG=$DebugMode" `
    $WardenImage
