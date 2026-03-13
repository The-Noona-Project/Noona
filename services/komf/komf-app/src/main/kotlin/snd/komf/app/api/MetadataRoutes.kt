package snd.komf.app.api

import io.github.oshai.kotlinlogging.KotlinLogging
import io.ktor.client.plugins.ResponseException
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.response.respondBytes
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import io.ktor.server.util.getOrFail
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable
import snd.komf.api.KomfErrorResponse
import snd.komf.api.KomfProviderSeriesId
import snd.komf.api.job.KomfMetadataJobId
import snd.komf.api.metadata.KomfIdentifyRequest
import snd.komf.api.metadata.KomfMetadataJobResponse
import snd.komf.api.metadata.KomfMetadataSeriesSearchResult
import snd.komf.app.api.mappers.fromProvider
import snd.komf.app.api.mappers.toProvider
import snd.komf.comicinfo.ComicInfoWriter.ComicInfoException
import snd.komf.mediaserver.MediaServerClient
import snd.komf.mediaserver.MetadataServiceProvider
import snd.komf.mediaserver.model.MediaServerLibraryId
import snd.komf.mediaserver.model.MediaServerSeriesId
import snd.komf.model.BookRange
import snd.komf.model.ProviderBookMetadata
import snd.komf.model.ProviderSeriesId
import snd.komf.providers.CoreProviders
import snd.komf.providers.MetadataProvider

private val logger = KotlinLogging.logger {}

class MetadataRoutes(
    private val metadataServiceProvider: Flow<MetadataServiceProvider>,
    private val mediaServerClient: Flow<MediaServerClient>,
) {

    fun registerRoutes(routing: Route) {
        routing.route("/metadata") {
            getProvidersRoute()
            searchSeriesRoute()
            getSeriesCoverRoute()
            identifySeriesRoute()
            seriesDetailsRoute()

            matchSeriesRoute()
            matchLibraryRoute()

            resetSeriesRoute()
            resetLibraryRoute()
        }
    }

    private fun Route.getProvidersRoute() {
        get("/providers") {
            val libraryId = call.request.queryParameters["libraryId"]?.let { MediaServerLibraryId(it) }

            val providers = (
                    libraryId
                        ?.let { metadataServiceProvider.first().metadataServiceFor(it.value).availableProviders(it) }
                        ?: metadataServiceProvider.first().defaultMetadataService().availableProviders()
                    )
                .map { it.providerName().name }

            call.respond(providers)
        }
    }

    private fun Route.searchSeriesRoute() {
        get("/search") {
            val seriesName = call.request.queryParameters["name"]
                ?: return@get call.response.status(HttpStatusCode.BadRequest)

            val seriesId = call.request.queryParameters["seriesId"]?.let { MediaServerSeriesId(it) }
            val libraryId = call.request.queryParameters["libraryId"]
                ?.let { MediaServerLibraryId(it) }
                ?: seriesId?.let { mediaServerClient.first().getSeries(it).libraryId }

            try {
                val searchResults = libraryId
                    ?.let {
                        metadataServiceProvider.first().metadataServiceFor(it.value)
                            .searchSeriesMetadata(seriesName, it)
                    }
                    ?: metadataServiceProvider.first().defaultMetadataService().searchSeriesMetadata(seriesName)

                call.respond(HttpStatusCode.OK, searchResults.map {
                    KomfMetadataSeriesSearchResult(
                        url = it.url,
                        imageUrl = it.imageUrl,
                        title = it.title,
                        provider = it.provider.fromProvider(),
                        resultId = KomfProviderSeriesId(it.resultId)
                    )
                })
            } catch (exception: ResponseException) {
                call.respond(exception.response.status, KomfErrorResponse(exception.response.bodyAsText()))
                logger.catching(exception)
            } catch (exception: Exception) {
                call.respond(
                    HttpStatusCode.InternalServerError,
                    KomfErrorResponse("${exception::class.simpleName} :${exception.message}")
                )
                logger.catching(exception)
            }
        }
    }

    private fun Route.getSeriesCoverRoute() {
        get("/series-cover") {
            val libraryId = MediaServerLibraryId(call.request.queryParameters.getOrFail("libraryId"))
            val provider = CoreProviders.valueOf(call.request.queryParameters.getOrFail("provider"))
            val providerSeriesId = ProviderSeriesId(call.request.queryParameters.getOrFail("providerSeriesId"))

            val metadataService = metadataServiceProvider.first().metadataServiceFor(libraryId.value)
            val image = metadataService.getSeriesCover(
                libraryId = libraryId,
                providerName = provider,
                providerSeriesId = providerSeriesId
            )
            image?.bytes?.let { call.respondBytes { it } }
                ?: call.response.status(HttpStatusCode.NotFound)

        }
    }

    private fun Route.identifySeriesRoute() {
        post("/identify") {
            val request = call.receive<KomfIdentifyRequest>()

            val libraryId = request.libraryId?.value
                ?: mediaServerClient.first().getSeries(MediaServerSeriesId(request.seriesId.value)).libraryId.value

            val jobId = metadataServiceProvider.first().metadataServiceFor(libraryId).setSeriesMetadata(
                MediaServerSeriesId(request.seriesId.value),
                request.provider.toProvider(),
                ProviderSeriesId(request.providerSeriesId.value),
                null
            )

            call.respond(
                KomfMetadataJobResponse(KomfMetadataJobId(jobId.value.toString()))
            )
        }
    }

    private fun Route.seriesDetailsRoute() {
        get("/series-details") {
            val provider = call.request.queryParameters["provider"]
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let {
                    runCatching { CoreProviders.valueOf(it.uppercase()) }.getOrElse {
                        return@get call.respond(
                            HttpStatusCode.BadRequest,
                            KomfErrorResponse("IllegalArgumentException :Unsupported provider")
                        )
                    }
                }
                ?: return@get call.respond(
                    HttpStatusCode.BadRequest,
                    KomfErrorResponse("IllegalArgumentException :provider is required")
                )
            val providerSeriesId = call.request.queryParameters["providerSeriesId"]
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let(::ProviderSeriesId)
                ?: return@get call.respond(
                    HttpStatusCode.BadRequest,
                    KomfErrorResponse("IllegalArgumentException :providerSeriesId is required")
                )
            val libraryId = call.request.queryParameters["libraryId"]
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
                ?.let(::MediaServerLibraryId)

            try {
                val metadataService = libraryId
                    ?.let { metadataServiceProvider.first().metadataServiceFor(it.value) }
                    ?: metadataServiceProvider.first().defaultMetadataService()
                val providerClient = resolveMetadataProvider(metadataService, provider, libraryId)
                val seriesMetadata = providerClient.getSeriesMetadata(providerSeriesId)
                val books = seriesMetadata.books.map { book ->
                    val bookMetadata =
                        runCatching { providerClient.getBookMetadata(providerSeriesId, book.id) }.getOrNull()
                    KomfMetadataSeriesDetailsBook(
                        providerBookId = book.id.id,
                        title = book.name,
                        type = book.type,
                        edition = book.edition,
                        volumeNumber = book.number?.toSingleIntegerOrNull(),
                        volumeRangeStart = book.number?.start,
                        volumeRangeEnd = book.number?.end,
                        chapters = normalizeBookChapters(bookMetadata),
                        startChapter = bookMetadata?.metadata?.startChapter,
                        endChapter = bookMetadata?.metadata?.endChapter,
                    )
                }

                call.respond(
                    HttpStatusCode.OK,
                    KomfMetadataSeriesDetailsResponse(
                        provider = provider.name,
                        providerSeriesId = providerSeriesId.value,
                        libraryId = libraryId?.value,
                        title = seriesMetadata.metadata.title?.name,
                        books = books,
                    )
                )
            } catch (exception: ResponseException) {
                call.respond(exception.response.status, KomfErrorResponse(exception.response.bodyAsText()))
                logger.catching(exception)
            } catch (exception: Exception) {
                call.respond(
                    HttpStatusCode.InternalServerError,
                    KomfErrorResponse("${exception::class.simpleName} :${exception.message}")
                )
                logger.catching(exception)
            }
        }
    }

    private fun Route.matchSeriesRoute() {
        post("/match/library/{libraryId}/series/{seriesId}") {

            val libraryId = call.parameters.getOrFail("libraryId")
            val seriesId = MediaServerSeriesId(call.parameters.getOrFail("seriesId"))
            val jobId = metadataServiceProvider.first().metadataServiceFor(libraryId).matchSeriesMetadata(seriesId)

            call.respond(
                KomfMetadataJobResponse(KomfMetadataJobId(jobId.value.toString()))
            )
        }
    }

    private fun Route.matchLibraryRoute() {
        post("/match/library/{libraryId}") {
            val libraryId = MediaServerLibraryId(call.parameters.getOrFail("libraryId"))
            metadataServiceProvider.first().metadataServiceFor(libraryId.value).matchLibraryMetadata(libraryId)
            call.response.status(HttpStatusCode.Accepted)
        }
    }

    private fun Route.resetSeriesRoute() {
        post("/reset/library/{libraryId}/series/{seriesId}") {
            val libraryId = call.parameters.getOrFail("libraryId")
            val seriesId = MediaServerSeriesId(call.parameters.getOrFail("seriesId"))
            val removeComicInfo = call.queryParameters["removeComicInfo"].toBoolean()
            try {
                metadataServiceProvider.first().updateServiceFor(libraryId)
                    .resetSeriesMetadata(seriesId, removeComicInfo)
            } catch (e: ComicInfoException) {
                call.respond(HttpStatusCode.UnprocessableEntity, KomfErrorResponse(e.message))
                return@post
            }
            call.respond(HttpStatusCode.NoContent, "")
        }
    }

    private fun Route.resetLibraryRoute() {
        post("/reset/library/{libraryId}") {
            val libraryId = MediaServerLibraryId(call.parameters.getOrFail("libraryId"))
            val removeComicInfo = call.queryParameters["removeComicInfo"].toBoolean()
            metadataServiceProvider.first().updateServiceFor(libraryId.value)
                .resetLibraryMetadata(libraryId, removeComicInfo)
            call.response.status(HttpStatusCode.NoContent)
        }
    }

}

private fun resolveMetadataProvider(
    metadataService: snd.komf.mediaserver.metadata.MetadataService,
    provider: CoreProviders,
    libraryId: MediaServerLibraryId?,
): MetadataProvider {
    val providers = libraryId?.let { metadataService.availableProviders(it) } ?: metadataService.availableProviders()
    return providers.firstOrNull { it.providerName() == provider }
        ?: throw IllegalArgumentException("Provider $provider is not enabled for library ${libraryId?.value ?: "default"}")
}

private fun normalizeBookChapters(bookMetadata: ProviderBookMetadata?): List<Int> {
    return bookMetadata?.metadata?.chapters
        ?.map { it.number }
        ?.filter { it > 0 }
        ?.distinct()
        ?.sorted()
        ?: emptyList()
}

private fun BookRange.toSingleIntegerOrNull(): Int? {
    val normalizedStart = start.toInt()
    return if (start == end && start == normalizedStart.toDouble()) normalizedStart else null
}

@Serializable
private data class KomfMetadataSeriesDetailsResponse(
    val provider: String,
    val providerSeriesId: String,
    val libraryId: String? = null,
    val title: String? = null,
    val books: List<KomfMetadataSeriesDetailsBook>,
)

@Serializable
private data class KomfMetadataSeriesDetailsBook(
    val providerBookId: String,
    val title: String? = null,
    val type: String? = null,
    val edition: String? = null,
    val volumeNumber: Int? = null,
    val volumeRangeStart: Double? = null,
    val volumeRangeEnd: Double? = null,
    val chapters: List<Int> = emptyList(),
    val startChapter: Int? = null,
    val endChapter: Int? = null,
)
