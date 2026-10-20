
import json
import os
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

CERT_KEY = os.environ.get("KAMIS_CERT_KEY")
CERT_ID = os.environ.get("KAMIS_CERT_ID")

if not CERT_KEY or not CERT_ID:
    raise RuntimeError("KAMIS 인증정보가 GitHub Secrets에 등록되지 않았습니다.")

API_URL = "https://www.kamis.or.kr/service/price/xml.do"

# 100 식량작물 / 200 채소류 / 300 특용작물
# 400 과일류 / 500 축산물 / 600 수산물
CATEGORIES = {
    "100": "식량작물",
    "200": "채소류",
    "300": "특용작물",
    "400": "과일류",
    "500": "축산물",
    "600": "수산물",
}


def get_text(element, tag):
    node = element.find(tag)
    return node.text.strip() if node is not None and node.text else ""


def fetch_category(code, category_name):
    params = {
        "action": "dailyPriceByCategoryList",
        "p_cert_key": CERT_KEY,
        "p_cert_id": CERT_ID,
        "p_returntype": "xml",
        "p_product_cls_code": "01",  # 01: 소매가격
        "p_country_code": "1101",    # 서울
        "p_item_category_code": code,
        "p_convert_kg_yn": "N",
        # p_regday 생략: KAMIS의 최근 조사일자 기본값 사용
    }

    url = API_URL + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "TodayEatPriceBot/1.0"}
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
        status = response.status

    if status != 200:
        raise RuntimeError(f"KAMIS HTTP 오류: {status}")

    # 차단 페이지 또는 오류 응답을 가격 데이터로 저장하지 않음
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        preview = body[:200].decode("utf-8", errors="replace")
        raise RuntimeError(
            f"{category_name} 응답이 XML 형식이 아닙니다: {preview}"
        ) from exc

    condition = root.find(".//condition")
    if condition is not None:
        message = " ".join(condition.itertext()).strip()
        if "900" in message or "Unauthenticated" in message:
            raise RuntimeError(f"KAMIS 인증 오류: {message}")

    rows = []

    for item in root.findall(".//data/item"):
        rows.append({
            "category": category_name,
            "category_code": code,
            "name": get_text(item, "item_name"),
            "item_code": get_text(item, "itemcode"),
            "kind": get_text(item, "kind_name"),
            "kind_code": get_text(item, "kindcode"),
            "rank": get_text(item, "rank"),
            "unit": get_text(item, "unit"),
            "date": get_text(item, "day1"),
            "price": get_text(item, "dpr1"),
            "price_yesterday": get_text(item, "dpr2"),
            "price_week_ago": get_text(item, "dpr3"),
            "price_month_ago": get_text(item, "dpr5"),
            "price_year_ago": get_text(item, "dpr6"),
        })

    return rows


def main():
    all_rows = []

    for code, name in CATEGORIES.items():
        print(f"{name} 가격 조회 중...")
        rows = fetch_category(code, name)
        print(f"  조회 결과: {len(rows)}개")
        all_rows.extend(rows)

    # 모든 카테고리 조회가 비었으면 기존 파일을 덮어쓰지 않음
    if not all_rows:
        raise RuntimeError(
            "조회 결과가 없습니다. 기존 가격 데이터는 유지합니다."
        )

    output = {
        "success": True,
        "source": "KAMIS",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "count": len(all_rows),
        "items": all_rows,
    }

    output_path = Path("data/kamis-prices.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"완료: {output_path} ({len(all_rows)}개 상품)")


if __name__ == "__main__":
    main()

