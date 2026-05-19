const MUSICBRAINZ_USER_AGENT = "LeStudioPortfolio/1.0 (bturquety@eugeniaschool.com)";

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const LASTFM_API_KEY = process.env.LASTFM_API_KEY;

    if (!LASTFM_API_KEY) {
        return res.status(500).json({ error: "Missing LASTFM_API_KEY" });
    }

    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);

    const userInput = body?.userInput?.trim();

    if (!userInput) {
        return res.status(400).json({ error: "Missing userInput" });
    }

    try {
        const recommendations = await buildRecommendations(userInput, LASTFM_API_KEY);

        if (recommendations?.nonMusic) {
    return res.status(200).json({
        is_music: false,
        needs_clarification: false,
        clarification_message: null,
        recommendations: [],
        error_message: "On parle musique ici ! Essaie avec un artiste, un genre ou un morceau."
    });
}

        if (!recommendations.length) {
            return res.status(200).json({
                is_music: false,
                needs_clarification: false,
                clarification_message: null,
                recommendations: [],
                error_message: "Aucune correspondance musicale fiable trouvée. Essaie avec un artiste, un genre ou un morceau plus précis."
            });
        }

        return res.status(200).json({
            is_music: true,
            needs_clarification: false,
            clarification_message: null,
            recommendations: recommendations.slice(0, 5),
            error_message: null
        });

    } catch (error) {
        return res.status(500).json({
            error: "Server error",
            details: error.message
        });
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function buildRecommendations(input, apiKey) {
    const similarArtists = await getSimilarArtists(input, apiKey);

        if (similarArtists?.nonMusic) {
            return { nonMusic: true };
        }

        if (similarArtists.length) {
        const results = [];

        for (const artist of similarArtists.slice(0, 10)) {
            if (normalize(artist.name) === normalize(input)) continue;

            const topTrack = await getArtistTopTrack(artist.name, apiKey);
            if (!topTrack) continue;

            await sleep(1100);

            const enriched = await enrichWithMusicBrainz({
                artist: artist.name,
                title: topTrack.title,
                album: topTrack.album || "",
                year: "",
                reason: `Artiste proche de ${input}, selon les similarités d'écoute Last.fm.`
            });

            results.push(enriched);

            if (results.length >= 5) break;
        }

        return results;
    }

    return await getTagRecommendations(input, apiKey);
}

async function getSimilarArtists(artist, apiKey) {
    const data = await lastfm(apiKey, {
        method: "artist.getsimilar",
        artist,
        autocorrect: "1",
        limit: "12"
    });

    if (data?.nonMusic) {
        return { nonMusic: true };
    }

    const artists = data?.similarartists?.artist;

    if (!artists) return [];

    return Array.isArray(artists) ? artists : [artists];
}

async function getArtistTopTrack(artist, apiKey) {
    const data = await lastfm(apiKey, {
        method: "artist.gettoptracks",
        artist,
        autocorrect: "1",
        limit: "5"
    });

    const tracks = data?.toptracks?.track;
    const list = Array.isArray(tracks) ? tracks : tracks ? [tracks] : [];

    const track = list.find(item => item?.name);

    if (!track) return null;

    const info = await getTrackInfo(artist, track.name, apiKey);

    return {
        title: track.name,
        album: info?.album || ""
    };
}

async function getTrackInfo(artist, track, apiKey) {
    try {
        const data = await lastfm(apiKey, {
            method: "track.getinfo",
            artist,
            track,
            autocorrect: "1"
        });

        return {
            album: data?.track?.album?.title || ""
        };
    } catch {
        return null;
    }
}

async function getTagRecommendations(tag, apiKey) {
    const data = await lastfm(apiKey, {
        method: "tag.gettoptracks",
        tag,
        limit: "10"
    });

    const tracks = data?.tracks?.track;
    const list = Array.isArray(tracks) ? tracks : tracks ? [tracks] : [];

    const results = [];

    for (const item of list) {
        const title = item?.name;
        const artist = item?.artist?.name;

        if (!title || !artist) continue;

        const info = await getTrackInfo(artist, title, apiKey);

        await sleep(1100);

        const enriched = await enrichWithMusicBrainz({
            artist,
            title,
            album: info?.album || "",
            year: "",
            reason: `Morceau lié au tag ou à l’univers musical "${tag}" sur Last.fm.`
        });

        results.push(enriched);

        if (results.length >= 5) break;
    }

    return results;
}

async function enrichWithMusicBrainz(track) {
    const recordingQuery = encodeURIComponent(`recording:"${track.title}" AND artist:"${track.artist}"`);

    try {
        const response = await fetch(
            `https://musicbrainz.org/ws/2/recording/?query=${recordingQuery}&fmt=json&limit=10&inc=releases+artist-credits+release-groups`,
            {
                headers: {
                    "User-Agent": MUSICBRAINZ_USER_AGENT
                }
            }
        );

        if (!response.ok) return track;

        const data = await response.json();
        const recordings = data?.recordings || [];

        const bestRecording = recordings.find(recording => {
            const titleMatch = normalize(recording.title) === normalize(track.title);
            const artistMatch = recording["artist-credit"]?.some(credit =>
                normalize(credit.artist?.name || "") === normalize(track.artist)
            );

            return titleMatch && artistMatch;
        });

        if (!bestRecording) return track;

        const releases = bestRecording.releases || [];

        const cleanReleases = releases
            .filter(release => release["release-group"])
            .filter(release => {
                const group = release["release-group"];
                const primaryType = normalize(group["primary-type"]);
                const secondaryTypes = group["secondary-types"] || [];
                const title = normalize(group.title || release.title);

                const badSecondary = secondaryTypes.some(type => {
                    const value = normalize(type);

                    return (
                        value.includes("compilation") ||
                        value.includes("live") ||
                        value.includes("remix") ||
                        value.includes("dj-mix") ||
                        value.includes("mixtape") ||
                        value.includes("soundtrack")
                    );
                });

                const badTitle =
                    title.includes("live") ||
                    title.includes("compilation") ||
                    title.includes("best of") ||
                    title.includes("greatest hits") ||
                    title.includes("remaster") ||
                    title.includes("remastered") ||
                    title.includes("anniversary") ||
                    title.includes("deluxe") ||
                    title.includes("expanded") ||
                    title.includes("bonus") ||
                    title.includes("demo") ||
                    title.includes("bootleg");

                const validPrimary =
                    primaryType === "album" ||
                    primaryType === "single" ||
                    primaryType === "ep";

                return validPrimary && !badSecondary && !badTitle;
            })
            .sort((a, b) => {
                const dateA = a["release-group"]?.["first-release-date"] || a.date || "9999";
                const dateB = b["release-group"]?.["first-release-date"] || b.date || "9999";

                return new Date(dateA) - new Date(dateB);
            });

        const release = cleanReleases[0] || null;

        if (!release) {
            return {
                title: bestRecording.title || track.title,
                artist: track.artist,
                album: track.album || "Single / release",
                year: track.year || "—",
                cover_url: null,
                reason: track.reason
            };
        }

        const group = release["release-group"];
        const album = group?.title || release.title || track.album || "Single / release";
        const yearSource = group?.["first-release-date"] || release.date || track.year || "";
        const year = yearSource ? yearSource.slice(0, 4) : "—";

        const coverUrl = release?.id ? await getCoverArtUrl(release.id) : null;

        return {
            title: bestRecording.title || track.title,
            artist: track.artist,
            album,
            year,
            cover_url: coverUrl,
            reason: track.reason
        };

    } catch {
        return track;
    }
}

async function getCoverArtUrl(releaseId) {
    try {
        const response = await fetch(`https://coverartarchive.org/release/${releaseId}`, {
            headers: {
                "User-Agent": MUSICBRAINZ_USER_AGENT
            }
        });

        if (!response.ok) return null;

        const data = await response.json();
        const front = data.images?.find(image => image.front) || data.images?.[0];

        return front?.thumbnails?.large || front?.thumbnails?.small || front?.image || null;

    } catch {
        return null;
    }
}

async function lastfm(apiKey, params) {
    const url = new URL("https://ws.audioscrobbler.com/2.0/");

    Object.entries({
        ...params,
        api_key: apiKey,
        format: "json"
    }).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Last.fm error: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {

        if (data.error === 6) {
            return {
                nonMusic: true
            };
        }

        throw new Error(`Last.fm error ${data.error}: ${data.message}`);
    }

    return data;
}

function normalize(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}