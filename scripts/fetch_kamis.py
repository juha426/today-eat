
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://apis.data.go.kr/B552845/recent/price"
SERVICE_KEY = os.environ.get("DATA_GO_KR_SERVICE_KEY")

if not SERVICE_KEY:
    raise RuntimeError(
        "DATA_GO_KR_SERVICE_KEY가 GitHub Secrets에 없습니다."
    )

CATEGORY_NAMES = {
    "100": "식량작물",
    "200": "채소류",
    "300": "특용작물",
    "400": "과일류",
    "500": "축산물",
    "600": "수산물",
}


def fetch_page(page_no):
    params = {
        "serviceKey": SERVICE_KEY,
        "returnType": "JSON",
        "pageNo": page_no,
        "numOfRows": 1000,
        "cond[se_cd::EQ]": "01",  # 01: 소매가격
    }

    url = API_URL + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "TodayEatPriceBot/1.0"}
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()

    try:
        result = json.loads(raw.decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError) as exc:
        preview = raw[:300].decode("utf-8", errors="replace")
        raise RuntimeError(
            f"API 응답이 JSON이 아닙니다: {preview}"
        ) from exc

    # 공공데이터포털 표준 응답 구조
    response_data = result.get("response", result)
    header = response_data.get("header", {})
    code = str(header.get("resultCode", "00"))

    if code not in ("00", "0"):
        raise RuntimeError(
            "공공데이터 API 오류: "
            + str(header.get("resultMsg", code))
        )

    body = response_data.get("body", {})
    items_container = body.get("items", {})
    items = items_container.get("item", [])

    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        items = []

    return items, int(body.get("totalCount", 0))


def main():
    all_items = []
    page_no = 1
    total_count = None

    while True:
        print(f"가격 데이터 조회: {page_no}페이지")
        rows, count = fetch_page(page_no)

        if total_count is None:
            total_count = count
            print(f"전체 데이터 수: {total_count}")

        all_items.extend(rows)

        if not rows or len(all_items) >= total_count:
            break

        page_no += 1

    if not all_items:
        raise RuntimeError(
            "조회된 가격 데이터가 없습니다. "
            "기존 파일은 유지합니다."
        )

    normalized = []

    for item in all_items:
        category_code = str(item.get("ctgry_cd", ""))

        normalized.append({
            "category": CATEGORY_NAMES.get(
                category_code, item.get("ctgry_nm", "기타")
            ),
            "category_code": category_code,
            "name": item.get("item_nm", ""),
            "item_code": item.get("item_cd", ""),
            "kind": item.get("vrty_nm", ""),
            "kind_code": item.get("vrty_cd", ""),
            "rank": item.get("grd_nm", ""),
            "unit": item.get("unit", ""),
            "date": item.get("exmn_ymd", ""),
            "price": item.get("exmn_dd_prc", ""),
            "price_yesterday": item.get("dd1_bfr_prc", ""),
            "price_week_ago": item.get("ww1_bfr_prc", ""),
            "price_month_ago": item.get("mm1_bfr_prc", ""),
            "price_year_ago": item.get("yy1_bfr_prc", ""),
        })

    output = {
        "success": True,
        "source": "공공데이터포털 최근일자 도소매가격정보",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "count": len(normalized),
        "items": normalized,
    }

    path = Path("data/kamis-prices.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"저장 완료: {path} / {len(normalized)}개")


if __name__ == "__main__":
    main()

