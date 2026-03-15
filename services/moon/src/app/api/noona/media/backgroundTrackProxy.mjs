export const buildBackgroundTrackProxyHeaders = ({authorization = '', range = ''} = {}) => {
    const headers = {}
    const normalizedAuthorization = typeof authorization === 'string' ? authorization.trim() : ''
    const normalizedRange = typeof range === 'string' ? range.trim() : ''

    if (normalizedAuthorization) {
        headers.Authorization = normalizedAuthorization
    }

    if (normalizedRange) {
        headers.Range = normalizedRange
    }

    return headers
}

export const createBackgroundTrackProxyResponse = (upstreamResponse) =>
    new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: new Headers(upstreamResponse.headers),
    })

export const proxyBackgroundTrackRequest = async ({authorization = '', range = '', fetchTrack}) => {
    const upstreamResponse = await fetchTrack({
        headers: buildBackgroundTrackProxyHeaders({authorization, range}),
    })

    return createBackgroundTrackProxyResponse(upstreamResponse)
}
