from fastapi import APIRouter, Depends, Request

from app.config import Settings, get_settings
from app.services.app_releases import AppReleases, AppReleasesOut

router = APIRouter(prefix="/api", tags=["apps"])


def get_app_releases(
    request: Request,
    settings: Settings = Depends(get_settings),  # noqa: B008
) -> AppReleases:
    """One per process, so its half-hour cache is shared by every request."""
    found = getattr(request.app.state, "app_releases", None)
    if found is None:
        found = AppReleases(settings.github_repo)
        request.app.state.app_releases = found
    return found


@router.get("/app/releases")
async def app_releases(
    releases: AppReleases = Depends(get_app_releases),  # noqa: B008
) -> AppReleasesOut:
    """The newest downloadable version of each app. Public: the same list as the releases page."""
    return await releases.latest()
