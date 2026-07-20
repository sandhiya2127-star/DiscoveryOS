from pathlib import Path

path = Path('main.py')
text = path.read_text(encoding='utf-8')
marker = 'print("======================================")\n        raise e\n\n\n\n@app.post("/ingest")'
insert = '''print("======================================")
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
'''

if 'def safe_generate_content' in text:
    print('Helpers already present; no change.')
else:
    if marker not in text:
        raise RuntimeError('Marker not found in main.py')
    text = text.replace(marker, insert, 1)
    path.write_text(text, encoding='utf-8')
    print('Patched main.py')
