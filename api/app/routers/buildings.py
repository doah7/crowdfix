from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..models import Building, Topic
from ..schemas import BuildingOut

router = APIRouter(prefix="/api/buildings", tags=["buildings"], dependencies=[Depends(current_user)])


@router.get("", response_model=list[BuildingOut])
def list_buildings(db: Session = Depends(get_db)):
    """건물 검색과 Report 장소 선택에 쓰는 전체 건물·장소 목록."""
    counts = dict(db.execute(
        select(Topic.building_id, func.count()).where(Topic.building_id.is_not(None)).group_by(Topic.building_id)
    ).all())
    buildings = db.scalars(select(Building).order_by(Building.kind, Building.name_ko)).all()
    return [
        BuildingOut(
            id=b.id, build_no=b.build_no, name_ko=b.name_ko, name_en=b.name_en,
            latitude=b.latitude, longitude=b.longitude, kind=b.kind,
            topic_count=counts.get(b.id, 0),
        )
        for b in buildings
    ]
