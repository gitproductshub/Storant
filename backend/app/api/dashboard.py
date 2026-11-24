"""Home dashboard for every business login. What each person sees is decided in app.services.dashboard."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.tenant import get_tenant_db
from app.services import dashboard
from app.services.access import Access, get_access

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("")
async def my_dashboard(widgets: str | None = Query(None, max_length=300, pattern=r"^[a-z_,]*$"),
                       access: Access = Depends(get_access), db: AsyncSession = Depends(get_tenant_db)):
    """The signed-in person's widgets with today's data (India time, the same rules as Reports).

    `widgets=a,b`: only these (keys from an earlier response); unknown keys and widgets this person may not see are ignored.
    Money is left out for people who can't take payments or see reports.
    """
    only = {w for w in widgets.split(",") if w} if widgets else None
    return await dashboard.build_dashboard(db, access, only)
