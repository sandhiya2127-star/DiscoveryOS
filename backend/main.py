import os
import re
import csv
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List
from io import StringIO
from dotenv import load_dotenv

from fastapi import FastAPI, UploadFile, File, Query, Form, HTTPException, Header, Request, BackgroundTasks, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import sqlalchemy as sa
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float, Text, ForeignKey, JSON, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import google.generativeai as genai
import pandas as pd
import pytesseract
import fitz
import ffmpeg
import tempfile
import uuid
from pydantic import BaseModel
import requests
from passlib.context import CryptContext
from jose import JWTError, jwt

load_dotenv()
app = FastAPI()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = PROJECT_ROOT / "frontend" / "static"
if not STATIC_DIR.exists():
    STATIC_DIR = Path(__file__).resolve().parent / "static"

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

# ===== AUTH CONFIG =====
SECRET_KEY = os.getenv("SECRET_KEY", "discoveryos-jwt-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))

class FeedbackItem(Base):
    __tablename__ = "feedback_items"
    id = Column(Integer, primary_key=True)
    raw_text = Column(String, unique=True)
    source = Column(String)
    segment = Column(String)
    customer_id = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

class Run(Base):
    __tablename__ = "runs"
    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    strategy = Column(String)
    summary = Column(Text, nullable=True)
    comparison_narrative = Column(Text, nullable=True)

class PainPoint(Base):
    __tablename__ = "pain_points"
    id = Column(Integer, primary_key=True)
    feedback_id = Column(Integer, ForeignKey("feedback_items.id"))
    run_id = Column(Integer, ForeignKey("runs.id"))
    pain_point = Column(String)
    severity_signal = Column(String)

class Theme(Base):
    __tablename__ = "themes"
    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, ForeignKey("runs.id"))
    theme = Column(String)
    frequency = Column(Integer)
    segments_affected = Column(JSON)
    segment_breakdown = Column(JSON)
    source_counts = Column(JSON)
    unique_customers = Column(Integer)
    sentiment = Column(String)
    goal_tag = Column(String)
    problem_statement = Column(String)
    hypothesis = Column(String)
    bet_size = Column(String)
    sample_quotes = Column(JSON)
    customer_impact = Column(Float)
    severity = Column(Float)
    business_impact = Column(Float)
    strategic_alignment = Column(Float)
    segment_value = Column(Float)
    priority_score = Column(Float)
    score_breakdown = Column(JSON)
    confidence_pct = Column(Float)
    confidence_explanation = Column(Text, nullable=True)
    is_new = Column(sa.Boolean, default=False)
    velocity = Column(String)
    trend_flag = Column(String)
    reasons = Column(JSON)

class SyncSource(Base):
    __tablename__ = "sync_sources"
    id = Column(Integer, primary_key=True)
    source_name = Column(String, unique=True)
    last_synced_at = Column(DateTime, nullable=True)
    status = Column(String)
    error_message = Column(String, nullable=True)

class Credential(Base):
    __tablename__ = "credentials"
    id = Column(Integer, primary_key=True)
    source_name = Column(String, unique=True)
    token = Column(String)
    saved_at = Column(DateTime, default=datetime.utcnow)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

# Programmatic self-healing migrations for existing database files
def run_migrations():
    try:
        with engine.begin() as conn:
            inspector = sa.inspect(conn)
            runs_cols = {col["name"] for col in inspector.get_columns("runs")}
            if "summary" not in runs_cols:
                conn.execute(sa.text("ALTER TABLE runs ADD COLUMN summary TEXT"))
            if "comparison_narrative" not in runs_cols:
                conn.execute(sa.text("ALTER TABLE runs ADD COLUMN comparison_narrative TEXT"))

            themes_cols = {col["name"] for col in inspector.get_columns("themes")}
            if "confidence_explanation" not in themes_cols:
                conn.execute(sa.text("ALTER TABLE themes ADD COLUMN confidence_explanation TEXT"))
            if "is_new" not in themes_cols:
                conn.execute(sa.text("ALTER TABLE themes ADD COLUMN is_new BOOLEAN DEFAULT FALSE"))

        print("PostgreSQL migrations ran successfully.")
    except Exception as e:
        print(f"Migration error: {e}")

run_migrations()

# Seed default admin account if no users exist
def seed_admin():
    session = SessionLocal()
    try:
        if session.query(User).count() == 0:
            email = os.getenv("ADMIN_EMAIL", "admin@discoveryos.io")
            password = os.getenv("ADMIN_PASSWORD", "discoveryos2024")
            hashed = pwd_context.hash(password)
            user = User(email=email, password_hash=hashed)
            session.add(user)
            session.commit()
            print(f"Seeded default admin account: {email}")
    except Exception as e:
        print(f"Seed error: {e}")
    finally:
        session.close()

seed_admin()

# ===== AUTH HELPERS =====
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(authorization: Optional[str] = Header(None)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not authorization or not authorization.startswith("Bearer "):
        raise credentials_exception
    token = authorization[7:]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    session = SessionLocal()
    user = session.query(User).filter(User.email == email).first()
    session.close()
    if user is None:
        raise credentials_exception
    return user

# ===== AUTH MODELS =====
class LoginInput(BaseModel):
    email: str
    password: str

# ===== AUTH ENDPOINTS =====
@app.post("/auth/signup")
async def signup(data: LoginInput):
    session = SessionLocal()
    existing = session.query(User).filter(User.email == data.email).first()
    if existing:
        session.close()
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed = pwd_context.hash(data.password)
    user = User(email=data.email, password_hash=hashed)
    session.add(user)
    session.commit()
    session.close()
    token = create_access_token({"sub": data.email})
    return {"access_token": token, "token_type": "bearer", "email": data.email}

@app.post("/auth/login")
async def login(data: LoginInput):
    session = SessionLocal()
    user = session.query(User).filter(User.email == data.email).first()
    session.close()
    if not user or not pwd_context.verify(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token({"sub": user.email})
    return {"access_token": token, "token_type": "bearer", "email": user.email}

def deduplicate_text(text):
    session = SessionLocal()
    existing = session.query(FeedbackItem).filter(FeedbackItem.raw_text == text).first()
    session.close()
    return existing is not None

def extract_pre_flags(text):
    keywords = ['churn', 'cancel', 'refund', 'urgent', 'switching to competitor']
    text_lower = text.lower()
    return [kw for kw in keywords if kw in text_lower]

def parse_json_response(response_text):
    text = response_text.strip()
    
    # Step 1: Extract JSON from markdown code fences if present
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if match:
        text = match.group(1).strip()
    
    # Step 2: Try to extract JSON array or object from text with reasoning
    # Look for [ first (arrays are more common for Gemini responses)
    start_bracket = text.find("[")
    end_bracket = text.rfind("]")
    
    if start_bracket != -1 and end_bracket != -1 and end_bracket > start_bracket:
        text = text[start_bracket:end_bracket + 1]
    else:
        # Try to find JSON object if no array
        start_brace = text.find("{")
        end_brace = text.rfind("}")
        if start_brace != -1 and end_brace != -1 and end_brace > start_brace:
            text = text[start_brace:end_brace + 1]
    
    # Step 3: Clean up common markdown artifacts
    text = text.replace("\\n", "\n")
    
    # Step 4: Parse JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print("========== JSON PARSE FAILED ==========")
        print(f"Raw response:\n{response_text}")
        print(f"Extracted JSON:\n{text}")
        print(f"Exception: {e}")
        print("======================================")
        raise e


def is_quota_error(exc):
    msg = str(exc).lower()
    return any(keyword in msg for keyword in [
        'quota', 'rate-limit', 'rate limit', 'exceeded', '429', 'too many requests',
        'quota exceeded', 'rate limit exceeded', 'free tier', 'throttl'
    ])


def safe_generate_content(model_name, prompt):
    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as exc:
        print(f"GENAI ERROR ({model_name}): {exc}")
        if is_quota_error(exc):
            print("Detected API quota/rate-limit error. Falling back to deterministic processing.")
        return None


def simple_pain_point_extraction(feedback_items):
    pain_points = []
    for item in feedback_items:
        text = (item.raw_text or '').lower()
        if 'search' in text and 'irrelevant' in text:
            point = 'Search returns irrelevant results'
        elif 'dark mode' in text:
            point = 'Missing dark mode'
        elif any(term in text for term in ['slow', 'lag', 'performance', 'hang']):
            point = 'App performance is too slow'
        elif any(term in text for term in ['login', 'sign in', 'password', 'auth']):
            point = 'Login flow is broken'
        elif any(term in text for term in ['error', 'fail', 'failed', 'crash']):
            point = 'Application errors are blocking users'
        else:
            point = 'Users experience friction in the product flow'

        severity = 'urgent' if any(term in text for term in ['cancel', 'refund', 'urgent', "can't", 'cannot', 'failed', 'error']) else 'medium'
        pain_points.append({'pain_point': point, 'severity_signal': severity})
    return pain_points


def simple_cluster_themes(pain_points_list, feedback_items):
    grouped = {}
    for idx, pp in enumerate(pain_points_list):
        key = pp.get('pain_point', 'General issue')
        grouped.setdefault(key, []).append(idx)

    themes = []
    for theme_name, indexes in grouped.items():
        frequency = len(indexes)
        sample_quotes = []
        for i in indexes[:3]:
            raw = (feedback_items[i].raw_text or '').strip()
            if raw:
                sample_quotes.append(raw[:120])
        if not sample_quotes:
            sample_quotes = [theme_name]

        themes.append({
            'theme': theme_name,
            'frequency': frequency,
            'segments_affected': ['general'],
            'segment_breakdown': {'general': frequency},
            'source_counts': {'upload': frequency},
            'unique_customers': min(frequency, 5),
            'sentiment': 'negative',
            'goal_tag': 'Adoption blocker',
            'problem_statement': f'{theme_name} is creating friction for users.',
            'hypothesis': 'Reducing this friction will improve user satisfaction and retention.',
            'bet_size': 'M',
            'sample_quotes': sample_quotes
        })
    return themes


def simple_confidence_explanations(themes_data):
    return [
        f"Confidence is based on {t.get('frequency', 1)} report(s) and {len(t.get('source_counts', {}))} source(s)."
        for t in themes_data
    ]


def simple_summary(themes_data):
    if not themes_data:
        return 'No themes could be generated from the available feedback.'
    top = sorted(themes_data, key=lambda t: t.get('frequency', 0), reverse=True)[:3]
    return ' '.join([f"Top theme: {t.get('theme', 'Unknown')} with frequency {t.get('frequency', 0)}." for t in top])


def simple_comparison_narrative(preceding_themes_list, current_themes_list):
    if not preceding_themes_list:
        return 'This run generated a fresh set of themes based on the available feedback.'
    return 'Analysis completed. Current themes were derived from the latest feedback and compared against prior themes.'


@app.post("/ingest")
async def ingest(
    json_data: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user)
):
    session = SessionLocal()
    inserted = 0
    
    items_to_insert = []
    
    if json_data:
        parsed = json.loads(json_data)
        if "items" in parsed:
            items_to_insert = parsed["items"]
    
    if file:
        content = await file.read()
        filename = file.filename.lower()
        
        if filename.endswith(('.csv', '.xlsx', '.xls')):
            if filename.endswith('.csv'):
                df = pd.read_csv(StringIO(content.decode('utf-8')))
            else:
                df = pd.read_excel(content)
            items_to_insert.extend(df.to_dict('records'))
        
        elif filename.endswith(('.md', '.txt')):
            raw_text = content.decode('utf-8')
            items_to_insert.append({
                "raw_text": raw_text,
                "source": filename,
                "segment": "general",
                "customer_id": "unknown"
            })
        
        elif filename.endswith(('.vtt', '.srt')):
            raw_text = content.decode('utf-8')
            raw_text = re.sub(r'^\d+$', '', raw_text, flags=re.MULTILINE)
            raw_text = re.sub(r'\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}', '', raw_text)
            raw_text = re.sub(r'\n\s*\n', '\n', raw_text).strip()
            items_to_insert.append({
                "raw_text": raw_text,
                "source": filename,
                "segment": "general",
                "customer_id": "unknown"
            })
            
        elif filename.endswith(('.jpg', '.jpeg', '.png')):
            import io
            from PIL import Image
            img = Image.open(io.BytesIO(content))
            text = pytesseract.image_to_string(img)
            items_to_insert.append({
                "raw_text": text.strip(),
                "source": "handwritten_note",
                "segment": "general",
                "customer_id": "unknown"
            })
            
        elif filename.endswith('.pdf'):
            doc = fitz.open(stream=content, filetype="pdf")
            text = ""
            for page in doc:
                text += page.get_text()
            items_to_insert.append({
                "raw_text": text.strip(),
                "source": "handwritten_note",
                "segment": "general",
                "customer_id": "unknown"
            })
            
        elif filename.endswith(('.mp3', '.wav', '.m4a', '.mp4', '.mov')):
            with tempfile.NamedTemporaryFile(delete=False, suffix='.' + filename.split('.')[-1]) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            
            try:
                audio_path = tmp_path
                if filename.endswith(('.mp4', '.mov')):
                    audio_path = tmp_path + '.wav'
                    try:
                        ffmpeg.input(tmp_path).output(audio_path, acodec='pcm_s16le', ac=1, ar='16k').run(quiet=True, overwrite_output=True)
                    except ffmpeg.Error as e:
                        print("FFMPEG error:", e.stderr)
                        raise e
                
                audio_file = genai.upload_file(path=audio_path)
                model = genai.GenerativeModel('gemini-1.5-flash')
                response = model.generate_content(
                    ["Please transcribe this audio and extract speaker turns if identifiable.", audio_file]
                )
                
                source_type = "video_call" if filename.endswith(('.mp4', '.mov')) else "call_recording"
                items_to_insert.append({
                    "raw_text": response.text.strip(),
                    "source": source_type,
                    "segment": "general",
                    "customer_id": "unknown"
                })
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
                if 'audio_path' in locals() and audio_path != tmp_path and os.path.exists(audio_path):
                    os.remove(audio_path)

        else:
            try:
                items_to_insert.extend(json.loads(content.decode('utf-8')))
            except:
                pass

    
    for item in items_to_insert:
        raw_text = (item.get("raw_text", "") or "").strip()
        if not raw_text:
            continue
        if deduplicate_text(raw_text):
            continue

        feedback = FeedbackItem(
            raw_text=raw_text,
            source=item.get("source", "") or "unknown",
            segment=item.get("segment", "") or "general",
            customer_id=item.get("customer_id", "") or "unknown"
        )
        session.add(feedback)
        inserted += 1
    
    session.commit()
    session.close()
    return {"inserted": inserted}

class CredentialInput(BaseModel):
    source_name: str
    token: str

@app.post("/config/credentials")
async def config_credentials(request: Request, cred: CredentialInput, current_user: User = Depends(get_current_user)):
    admin_key = request.headers.get("X-Admin-Key")
    expected_key = os.getenv("ADMIN_KEY", "secret123")
    if not admin_key or admin_key != expected_key:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    session = SessionLocal()
    existing = session.query(Credential).filter(Credential.source_name == cred.source_name).first()
    if existing:
        existing.token = cred.token
        existing.saved_at = datetime.utcnow()
    else:
        new_cred = Credential(source_name=cred.source_name, token=cred.token)
        session.add(new_cred)
    session.commit()
    session.close()
    return {"status": "success"}

async def _do_sync(source: str, session):
    cred = session.query(Credential).filter(Credential.source_name == source).first()
    if not cred:
        return 0, f"No credentials for {source}"
    
    sync_record = session.query(SyncSource).filter(SyncSource.source_name == source).first()
    if not sync_record:
        sync_record = SyncSource(source_name=source)
        session.add(sync_record)
        session.commit()
    
    # Generic mock sync behavior to simulate external fetch using cred.token
    items_to_insert = [
        {"raw_text": f"Mock data from {source} - message 1", "source": source, "segment": "general", "customer_id": "unknown"},
        {"raw_text": f"Mock data from {source} - message 2", "source": source, "segment": "general", "customer_id": "unknown"}
    ]
    
    inserted = 0
    for item in items_to_insert:
        if not deduplicate_text(item.get("raw_text", "")):
            feedback = FeedbackItem(
                raw_text=item.get("raw_text", ""),
                source=item.get("source", ""),
                segment=item.get("segment", ""),
                customer_id=item.get("customer_id", "")
            )
            session.add(feedback)
            inserted += 1
            
    sync_record.last_synced_at = datetime.utcnow()
    sync_record.status = "success"
    session.commit()
    return inserted, None

@app.post("/sync/{source}")
async def sync_source(source: str, current_user: User = Depends(get_current_user)):
    if source not in ['slack', 'zendesk', 'survey']:
        raise HTTPException(status_code=400, detail="Unsupported source")
        
    session = SessionLocal()
    inserted, err = await _do_sync(source, session)
    session.close()
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"source": source, "inserted": inserted}

@app.post("/sync_all")
async def sync_all(current_user: User = Depends(get_current_user)):
    session = SessionLocal()
    results = {}
    total = 0
    for source in ['slack', 'zendesk', 'survey']:
        inserted, err = await _do_sync(source, session)
        if not err:
            results[source] = inserted
            total += inserted
    session.close()
    return {"total_inserted": total, "details": results}

processing_status = {}

def run_processing_pipeline(run_id: int, strategy: str):
    session = SessionLocal()
    try:
        # Stage 1: Reading feedback items
        processing_status[run_id] = {"stage": "Reading feedback items", "status": "processing"}
        
        feedback_items = session.query(FeedbackItem).all()
        
        items_with_flags = []
        for item in feedback_items:
            pre_flags = extract_pre_flags(item.raw_text)
            items_with_flags.append({
                "id": item.id,
                "raw_text": item.raw_text,
                "pre_flags": pre_flags
            })
            
        # Stage 2: Extracting pain points
        processing_status[run_id] = {"stage": "Extracting pain points", "status": "processing"}
        
        prompt_call1 = f"""You are analyzing customer feedback to extract pain points. For each item, reason step by step:
1. What is the user trying to accomplish (their goal)?
2. What blocked them from achieving it?
3. How severe is this issue?

Examples:
- Input: "I can't find anything in search, it's useless" -> pain_point: "Search returns irrelevant results", severity_signal: "urgent"
- Input: "Would be nice if it had dark mode" -> pain_point: "Missing dark mode", severity_signal: "minor"

Feedback items with pre-flagged keywords:
{json.dumps(items_with_flags, indent=2)}

For each item, output JSON array with pain_point (string) and severity_signal (urgent/high/medium/minor).

STRICT OUTPUT INSTRUCTIONS:
- Return ONLY a valid JSON array.
- Do NOT explain your reasoning.
- Do NOT include chain-of-thought.
- Do NOT include markdown.
- Do NOT wrap the output in ```json.
- Do NOT include any text before or after the JSON.
"""
        
        text1 = safe_generate_content("gemini-3.5-flash", prompt_call1)
        if text1 is not None:
            try:
                pain_points_data = parse_json_response(text1)
            except Exception as e:
                print(f"JSON parse error Call 1: {e}")
                pain_points_data = []
        else:
            pain_points_data = []

        if not pain_points_data:
            pain_points_data = simple_pain_point_extraction(feedback_items)
            
        pain_points_list = []
        for i, item in enumerate(feedback_items):
            if i < len(pain_points_data):
                pp_data = pain_points_data[i]
                pp = PainPoint(
                    feedback_id=item.id,
                    run_id=run_id,
                    pain_point=pp_data.get("pain_point", ""),
                    severity_signal=pp_data.get("severity_signal", "medium")
                )
                session.add(pp)
                pain_points_list.append(pp_data)
                
        session.commit()
        
        # Stage 3: Clustering into themes
        processing_status[run_id] = {"stage": "Clustering into themes", "status": "processing"}
        
        prompt_call2 = f"""You are clustering customer pain points into themes. Think step by step about why points belong together, then cluster.

Pain points:
{json.dumps(pain_points_list, indent=2)}

For each theme, output JSON array with:
- theme (string): descriptive name
- frequency (int): count of items
- segments_affected (array): affected customer segments
- segment_breakdown (object): segment -> count
- source_counts (object): source -> count
- unique_customers (int): count of unique customers
- sentiment (string): positive/neutral/negative
- goal_tag (string): "Retention risk"/"Adoption blocker"/"Nice-to-have polish"
- problem_statement (string): concise problem
- hypothesis (string): why this matters
- bet_size (string): S/M/L
- sample_quotes (array): 2-3 direct quotes

STRICT OUTPUT INSTRUCTIONS:
- Return ONLY a valid JSON array.
- Do NOT explain your reasoning.
- Do NOT include chain-of-thought.
- Do NOT include markdown.
- Do NOT wrap the output in ```json.
- Do NOT include any text before or after the JSON.
"""
        
        text2 = safe_generate_content("gemini-3.5-flash", prompt_call2)
        if text2 is not None:
            try:
                themes_data = parse_json_response(text2)
            except Exception as e:
                print(f"JSON parse error Call 2: {e}")
                themes_data = []
        else:
            themes_data = []

        if not themes_data:
            themes_data = simple_cluster_themes(pain_points_list, feedback_items)
            
        # Stage 4: Scoring priorities
        processing_status[run_id] = {"stage": "Scoring priorities", "status": "processing"}
        
        STRATEGY_WEIGHTS = {
            "Increase Revenue": {"Retention risk": 60, "Adoption blocker": 40, "Nice-to-have polish": 10},
            "Improve Retention": {"Retention risk": 100, "Adoption blocker": 30, "Nice-to-have polish": 5},
            "User Growth": {"Adoption blocker": 100, "Retention risk": 40, "Nice-to-have polish": 10},
            "Reduce Churn": {"Retention risk": 100, "Adoption blocker": 20, "Nice-to-have polish": 5},
            "Enterprise Expansion": {"Retention risk": 50, "Adoption blocker": 30, "Nice-to-have polish": 5}
        }
        
        SEGMENT_WEIGHTS = {
            "Increase Revenue": {"Enterprise": 0.5, "SMB": 0.3, "Free": 0.2},
            "Improve Retention": {"Enterprise": 0.4, "SMB": 0.4, "Free": 0.2},
            "User Growth": {"Enterprise": 0.2, "SMB": 0.3, "Free": 0.5},
            "Reduce Churn": {"Enterprise": 0.4, "SMB": 0.4, "Free": 0.2},
            "Enterprise Expansion": {"Enterprise": 0.6, "SMB": 0.3, "Free": 0.1}
        }
        
        max_frequency = max([t.get("frequency", 1) for t in themes_data] or [1])
        
        # Pre-fetch the preceding run to determine is_new tags
        preceding_run = session.query(Run).filter(Run.id < run_id).order_by(Run.id.desc()).first()
        preceding_theme_names = set()
        if preceding_run:
            preceding_themes = session.query(Theme).filter(Theme.run_id == preceding_run.id).all()
            preceding_theme_names = {t.theme.strip().lower() for t in preceding_themes if t.theme}
            
        # Batch generate confidence explanations
        confidence_explanations = []
        if themes_data:
            explanation_items = []
            for t in themes_data:
                freq = t.get("frequency", 1)
                segs = t.get("segments_affected", [])
                srcs = t.get("source_counts", {})
                custs = t.get("unique_customers", 1)
                conf = min(100, len(srcs) * 12 + len(segs) * 8 + min(custs, 10) * 5 + min(freq, 10) * 3)
                explanation_items.append({
                    "theme": t.get("theme"),
                    "confidence_pct": conf,
                    "sources_count": len(srcs),
                    "segments_count": len(segs),
                    "unique_customers": custs,
                    "frequency": freq
                })
                
            explanation_prompt = f"""You are an AI analyst. Generate a single-sentence confidence explanation (max 15 words) for each of these themes.
The explanation must explain why the confidence percentage is high, medium, or low based on the counts of sources, segments, customers, and frequency.
Examples:
- "High confidence due to 5 support tickets and 3 enterprise customer segments affected."
- "Low confidence because it was only reported by a single user on Slack."

Themes:
{json.dumps(explanation_items, indent=2)}

Output a JSON array of strings corresponding to the explanation for each theme in the same order.
STRICT OUTPUT INSTRUCTIONS:
- Return ONLY a valid JSON array of strings.
- Do NOT include markdown formatting or reasoning.
- Do NOT wrap in ```json.
"""
            exp_text = safe_generate_content("gemini-3.5-flash", explanation_prompt)
            if exp_text is not None:
                try:
                    confidence_explanations = parse_json_response(exp_text)
                except Exception as e:
                    print(f"Error generating confidence explanations: {e}")
                    confidence_explanations = []
            else:
                confidence_explanations = []
                
            while len(confidence_explanations) < len(themes_data):
                confidence_explanations.append(None)
                
        # Loop through themes and calculate everything
        for idx, theme_data in enumerate(themes_data):
            theme_name = theme_data.get("theme", "Unknown")
            frequency = theme_data.get("frequency", 1)
            segments_affected = theme_data.get("segments_affected", [])
            segment_breakdown = theme_data.get("segment_breakdown", {})
            source_counts = theme_data.get("source_counts", {})
            unique_customers = theme_data.get("unique_customers", 1)
            goal_tag = theme_data.get("goal_tag", "Adoption blocker")
            
            customer_impact = (frequency / max_frequency) * 100 if max_frequency > 0 else 0
            
            pre_flag_count = sum(1 for item in items_with_flags if any(flag in item['raw_text'].lower() for flag in ['churn', 'cancel', 'refund', 'urgent', 'switching']))
            if pre_flag_count > len(items_with_flags) * 0.5:
                severity = 100
            elif pre_flag_count > 0:
                severity = 60
            else:
                severity = 20
                
            top_segment = max(segment_breakdown.keys(), key=lambda k: segment_breakdown[k]) if segment_breakdown else "Unknown"
            business_impact = (segment_breakdown.get(top_segment, 0) / frequency * 100) if frequency > 0 else 0
            
            strategic_alignment = STRATEGY_WEIGHTS.get(strategy, {}).get(goal_tag, 50)
            
            segment_value = sum(
                segment_breakdown.get(seg, 0) / frequency * SEGMENT_WEIGHTS.get(strategy, {}).get(seg, 0.25)
                for seg in segment_breakdown.keys()
            ) * 100 if frequency > 0 else 0
            
            priority_score = (
                0.30 * customer_impact +
                0.25 * severity +
                0.20 * business_impact +
                0.15 * strategic_alignment +
                0.10 * segment_value
            )
            
            confidence_pct = min(
                100,
                len(source_counts) * 12 + len(segments_affected) * 8 + min(unique_customers, 10) * 5 + min(frequency, 10) * 3
            )
            
            conf_exp = confidence_explanations[idx] if idx < len(confidence_explanations) else None
            if not conf_exp:
                conf_exp = f"Based on {len(source_counts)} sources and {unique_customers} unique customer mentions."
                
            is_new = False
            if preceding_run:
                is_new = theme_name.strip().lower() not in preceding_theme_names
                
            now = datetime.utcnow()
            last_30 = now - timedelta(days=30)
            prior_30 = last_30 - timedelta(days=30)
            
            recent_count = session.query(FeedbackItem).filter(
                FeedbackItem.created_at >= last_30
            ).count()
            prior_count = session.query(FeedbackItem).filter(
                FeedbackItem.created_at >= prior_30,
                FeedbackItem.created_at < last_30
            ).count()
            
            velocity = None
            trend_flag = None
            if prior_count > 0 and recent_count / prior_count > 2.0:
                trend_flag = "Accelerating"
                
            reasons = [
                f"Affects {segment_breakdown.get(top_segment, 0)} {top_segment} customers",
                f"Mentioned in {source_counts.get('support_ticket', 0)} support tickets",
            ]
            if severity >= 80:
                reasons.append("High churn risk")
            reasons.append(f"Aligns with company goal: {goal_tag}")
            
            score_breakdown = {
                "customer_impact": {"value": customer_impact, "weight": 0.30},
                "severity": {"value": severity, "weight": 0.25},
                "business_impact": {"value": business_impact, "weight": 0.20},
                "strategic_alignment": {"value": strategic_alignment, "weight": 0.15},
                "segment_value": {"value": segment_value, "weight": 0.10},
                "total": priority_score
            }
            
            theme = Theme(
                run_id=run_id,
                theme=theme_name,
                frequency=frequency,
                segments_affected=segments_affected,
                segment_breakdown=segment_breakdown,
                source_counts=source_counts,
                unique_customers=unique_customers,
                sentiment=theme_data.get("sentiment", "neutral"),
                goal_tag=goal_tag,
                problem_statement=theme_data.get("problem_statement", ""),
                hypothesis=theme_data.get("hypothesis", ""),
                bet_size=theme_data.get("bet_size", "M"),
                sample_quotes=theme_data.get("sample_quotes", []),
                customer_impact=customer_impact,
                severity=severity,
                business_impact=business_impact,
                strategic_alignment=strategic_alignment,
                segment_value=segment_value,
                priority_score=priority_score,
                score_breakdown=score_breakdown,
                confidence_pct=confidence_pct,
                confidence_explanation=conf_exp,
                is_new=is_new,
                velocity=velocity,
                trend_flag=trend_flag,
                reasons=reasons
            )
            session.add(theme)
            
        session.commit()
        
        # Stage 5: Generating summary
        processing_status[run_id] = {"stage": "Generating summary", "status": "processing"}
        
        current_themes = session.query(Theme).filter(Theme.run_id == run_id).order_by(Theme.priority_score.desc()).all()
        top_themes = current_themes[:5] if current_themes else []
        top_themes_text = json.dumps([{
            "theme": t.theme,
            "frequency": t.frequency,
            "priority_score": t.priority_score,
            "problem_statement": t.problem_statement
        } for t in top_themes], indent=2)
        
        summary_text = safe_generate_content("gemini-3.1-flash-lite", f"Summarize these themes in 3 sentences for a product team:\n{top_themes_text}")
        current_summary = summary_text.strip() if summary_text else simple_summary(current_themes)
        
        run_record = session.query(Run).filter(Run.id == run_id).first()
        if run_record:
            run_record.summary = current_summary
            
        # Run comparison narrative
        comparison_narrative = None
        if preceding_run:
            preceding_themes = session.query(Theme).filter(Theme.run_id == preceding_run.id).all()
            preceding_themes_list = [{"theme": t.theme, "priority_score": t.priority_score, "frequency": t.frequency} for t in preceding_themes]
            current_themes_list = [{"theme": t.theme, "priority_score": t.priority_score, "frequency": t.frequency} for t in current_themes]
            
            comp_prompt = f"""Compare the customer feedback analysis of the current run with the preceding run.
Preceding Run Summary: {preceding_run.summary or ""}
Preceding Run Themes: {json.dumps(preceding_themes_list, indent=2)}

Current Run Summary: {current_summary}
Current Run Themes: {json.dumps(current_themes_list, indent=2)}

Generate a narrative comparison of changes between the two runs. Point out what has changed (e.g. priority shifts, new themes, increasing frequency of certain issues).
Keep it under 3-4 sentences, action-oriented for a product team. Do not include markdown headers or list formatting, return a clean paragraph."""
            comp_text = safe_generate_content("gemini-3.5-flash", comp_prompt)
            if comp_text is not None:
                comparison_narrative = comp_text.strip()
            else:
                comparison_narrative = simple_comparison_narrative(preceding_themes_list, current_themes_list)
                
        if run_record:
            run_record.comparison_narrative = comparison_narrative
            session.commit()
            
        processing_status[run_id] = {"stage": "Completed", "status": "completed"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        processing_status[run_id] = {"stage": "Error", "status": "failed", "error": str(e)}
    finally:
        session.close()

@app.post("/process")
async def process(strategy: str, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    session = SessionLocal()
    run = Run(strategy=strategy)
    session.add(run)
    session.commit()
    run_id = run.id
    session.close()
    
    # Track status
    processing_status[run_id] = {"stage": "Reading feedback items", "status": "processing"}
    background_tasks.add_task(run_processing_pipeline, run_id, strategy)
    
    return {"run_id": run_id, "strategy": strategy}

@app.get("/process/status")
async def get_process_status(run_id: int, current_user: User = Depends(get_current_user)):
    status = processing_status.get(run_id)
    if not status:
        session = SessionLocal()
        run = session.query(Run).filter(Run.id == run_id).first()
        session.close()
        if run:
            return {"status": "completed", "stage": "Completed"}
        raise HTTPException(status_code=404, detail="Run status not found")
    return status

class AskRequest(BaseModel):
    run_id: int
    question: str

@app.post("/ask")
async def ask(req: AskRequest, current_user: User = Depends(get_current_user)):
    session = SessionLocal()
    themes = session.query(Theme).filter(Theme.run_id == req.run_id).all()
    run = session.query(Run).filter(Run.id == req.run_id).first()
    
    if not run:
        session.close()
        raise HTTPException(status_code=404, detail="Run not found")
        
    session.close()
    
    themes_context = []
    for t in themes:
        themes_context.append({
            "theme_name": t.theme,
            "problem_statement": t.problem_statement,
            "hypothesis": t.hypothesis,
            "reasons": t.reasons,
            "frequency": t.frequency,
            "confidence_pct": t.confidence_pct,
            "priority_score": t.priority_score,
            "goal_tag": t.goal_tag
        })
        
    context = {
        "run_summary": run.summary or "",
        "themes": themes_context
    }
    
    prompt = f"""You are DiscoveryOS, an AI Product Manager Assistant.
Answer the user's question about the feedback analysis using ONLY the provided data.
Do not assume or make up facts. Cite the relevant theme name(s) that support your answer.

Data:
{json.dumps(context, indent=2)}

Question:
{req.question}

Answer:"""
    
    model = genai.GenerativeModel("gemini-3.5-flash")
    response = model.generate_content(prompt)
    
    return {"answer": response.text.strip()}


@app.get("/report")
async def report(run_id: int, current_user: User = Depends(get_current_user)):
    session = SessionLocal()
    
    run = session.query(Run).filter(Run.id == run_id).first()
    if not run:
        session.close()
        raise HTTPException(status_code=404, detail=f"No run found for run_id {run_id}.")
        
    themes = session.query(Theme).filter(Theme.run_id == run_id).order_by(Theme.priority_score.desc()).all()
    
    summary = run.summary
    if not summary:
        top_themes = themes[:5] if themes else []
        top_themes_text = json.dumps([{
            "theme": t.theme,
            "frequency": t.frequency,
            "priority_score": t.priority_score,
            "problem_statement": t.problem_statement
        } for t in top_themes], indent=2)
        
        try:
            model = genai.GenerativeModel("gemini-3.1-flash-lite")
            summary_response = model.generate_content(
                f"Summarize these themes in 3 sentences for a product team:\n{top_themes_text}"
            )
            summary = summary_response.text.strip()
            run.summary = summary
            session.commit()
        except Exception as e:
            print(f"Error generating summary: {e}")
            summary = "Summary generation failed."
            
    themes_data = []
    for theme in themes:
        customer_impact_stars = round(theme.customer_impact / 20) if theme.customer_impact else 0
        business_impact_stars = round(theme.business_impact / 20) if theme.business_impact else 0
        severity_stars = round(theme.severity / 20) if theme.severity else 0
        strategic_alignment_stars = round(theme.strategic_alignment / 20) if theme.strategic_alignment else 0
        
        themes_data.append({
            "theme": theme.theme,
            "frequency": theme.frequency,
            "priority_score": round(theme.priority_score, 2) if theme.priority_score else 0,
            "confidence_pct": round(theme.confidence_pct, 1) if theme.confidence_pct else 0,
            "confidence_explanation": theme.confidence_explanation,
            "is_new": theme.is_new,
            "customer_impact": customer_impact_stars,
            "business_impact": business_impact_stars,
            "severity": severity_stars,
            "strategic_alignment": strategic_alignment_stars,
            "problem_statement": theme.problem_statement,
            "hypothesis": theme.hypothesis,
            "reasons": theme.reasons,
            "sample_quotes": theme.sample_quotes
        })
        
    session.close()
    
    decision_boundary = "DiscoveryOS ranks likely problem areas with evidence. You decide the roadmap."
    
    return {
        "run_id": run_id,
        "summary": summary,
        "comparison_narrative": run.comparison_narrative,
        "decision_boundary": decision_boundary,
        "themes": themes_data
    }

@app.post("/reprocess")
async def reprocess(run_id: int, strategy: str, current_user: User = Depends(get_current_user)):
    session = SessionLocal()
    
    run = session.query(Run).filter(Run.id == run_id).first()
    if run:
        run.strategy = strategy
        session.commit()
    
    themes = session.query(Theme).filter(Theme.run_id == run_id).all()
    
    STRATEGY_WEIGHTS = {
        "Increase Revenue": {"Retention risk": 60, "Adoption blocker": 40, "Nice-to-have polish": 10},
        "Improve Retention": {"Retention risk": 100, "Adoption blocker": 30, "Nice-to-have polish": 5},
        "User Growth": {"Adoption blocker": 100, "Retention risk": 40, "Nice-to-have polish": 10},
        "Reduce Churn": {"Retention risk": 100, "Adoption blocker": 20, "Nice-to-have polish": 5},
        "Enterprise Expansion": {"Retention risk": 50, "Adoption blocker": 30, "Nice-to-have polish": 5}
    }
    
    SEGMENT_WEIGHTS = {
        "Increase Revenue": {"Enterprise": 0.5, "SMB": 0.3, "Free": 0.2},
        "Improve Retention": {"Enterprise": 0.4, "SMB": 0.4, "Free": 0.2},
        "User Growth": {"Enterprise": 0.2, "SMB": 0.3, "Free": 0.5},
        "Reduce Churn": {"Enterprise": 0.4, "SMB": 0.4, "Free": 0.2},
        "Enterprise Expansion": {"Enterprise": 0.6, "SMB": 0.3, "Free": 0.1}
    }
    
    for theme in themes:
        frequency = theme.frequency
        segment_breakdown = theme.segment_breakdown or {}
        segments_affected = theme.segments_affected or []
        unique_customers = theme.unique_customers
        goal_tag = theme.goal_tag
        
        max_frequency = max(max([t.frequency for t in themes] or [1]), 1)
        customer_impact = (frequency / max_frequency) * 100 if max_frequency > 0 else 0
        
        top_segment = max(segment_breakdown.keys(), key=lambda k: segment_breakdown[k]) if segment_breakdown else "Unknown"
        business_impact = (segment_breakdown.get(top_segment, 0) / frequency * 100) if frequency > 0 else 0
        
        strategic_alignment = STRATEGY_WEIGHTS.get(strategy, {}).get(goal_tag, 50)
        
        segment_value = sum(
            segment_breakdown.get(seg, 0) / frequency * SEGMENT_WEIGHTS.get(strategy, {}).get(seg, 0.25)
            for seg in segment_breakdown.keys()
        ) * 100 if frequency > 0 else 0
        
        priority_score = (
            0.30 * customer_impact +
            0.25 * theme.severity +
            0.20 * business_impact +
            0.15 * strategic_alignment +
            0.10 * segment_value
        )
        
        score_breakdown = {
            "customer_impact": {"value": customer_impact, "weight": 0.30},
            "severity": {"value": theme.severity, "weight": 0.25},
            "business_impact": {"value": business_impact, "weight": 0.20},
            "strategic_alignment": {"value": strategic_alignment, "weight": 0.15},
            "segment_value": {"value": segment_value, "weight": 0.10},
            "total": priority_score
        }
        
        theme.customer_impact = customer_impact
        theme.business_impact = business_impact
        theme.strategic_alignment = strategic_alignment
        theme.segment_value = segment_value
        theme.priority_score = priority_score
        theme.score_breakdown = score_breakdown
    
    session.commit()
    
    themes_sorted = sorted(themes, key=lambda t: t.priority_score, reverse=True)
    
    themes_data = []
    for theme in themes_sorted:
        customer_impact_stars = round(theme.customer_impact / 20)
        business_impact_stars = round(theme.business_impact / 20)
        severity_stars = round(theme.severity / 20)
        strategic_alignment_stars = round(theme.strategic_alignment / 20)
        
        themes_data.append({
            "theme": theme.theme,
            "frequency": theme.frequency,
            "priority_score": round(theme.priority_score, 2),
            "confidence_pct": round(theme.confidence_pct, 1),
            "confidence_explanation": theme.confidence_explanation,
            "is_new": theme.is_new,
            "customer_impact": customer_impact_stars,
            "business_impact": business_impact_stars,
            "severity": severity_stars,
            "strategic_alignment": strategic_alignment_stars,
            "problem_statement": theme.problem_statement,
            "hypothesis": theme.hypothesis
        })
    
    session.close()
    
    return {"run_id": run_id, "strategy": strategy, "themes": themes_data}

@app.get("/export")
async def export(run_id: int, current_user: User = Depends(get_current_user)):
    session = SessionLocal()
    
    themes = session.query(Theme).filter(Theme.run_id == run_id).order_by(Theme.priority_score.desc()).all()
    
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "theme", "frequency", "priority_score", "confidence_pct", "reasons", "problem_statement", "hypothesis"
    ])
    
    for theme in themes:
        reasons_str = "; ".join(theme.reasons) if theme.reasons else ""
        writer.writerow([
            theme.theme,
            theme.frequency,
            round(theme.priority_score, 2),
            round(theme.confidence_pct, 1),
            reasons_str,
            theme.problem_statement,
            theme.hypothesis
        ])
    
    session.close()
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=themes_{run_id}.csv"}
    )

# ===== PAGE ROUTES =====
@app.get("/", response_class=FileResponse)
async def serve_landing():
    return FileResponse(str(STATIC_DIR / "landing.html"))

@app.get("/login", response_class=FileResponse)
async def serve_login():
    return FileResponse(str(STATIC_DIR / "login.html"))

@app.get("/signup", response_class=FileResponse)
async def serve_signup():
    return FileResponse(str(STATIC_DIR / "signup.html"))

@app.get("/app", response_class=FileResponse)
async def serve_app():
    return FileResponse(str(STATIC_DIR / "index.html"))

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
