"""
Comprehensive Gemini API Diagnostic Tool
Checks every possible issue with your API setup
"""

import os
import sys
from dotenv import load_dotenv

print("=" * 70)
print("GEMINI API DIAGNOSTIC TOOL")
print("=" * 70)

# Load .env
load_dotenv()
print("\n✓ Loaded .env file")

# Check 1: API Key exists
print("\n[1/6] Checking API key...")
api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")

if not api_key:
    print("❌ FAILED: No API key found in environment")
    print("\n   Fix: Add to backend/.env:")
    print("   GOOGLE_API_KEY=AIzaSy...")
    sys.exit(1)

print(f"✓ API key found: {api_key[:15]}...{api_key[-10:]}")
print(f"  Length: {len(api_key)} characters")

# Check 2: API Key format
print("\n[2/6] Validating API key format...")
if api_key.startswith("AIzaSy"):
    print("✓ Key format looks correct (starts with 'AIzaSy')")
elif api_key.startswith("AQ."):
    print("❌ WRONG KEY TYPE!")
    print("   This is NOT a Gemini API key")
    print("   Keys starting with 'AQ.' are for other Google services")
    print("\n   Fix: Get Gemini key from:")
    print("   https://aistudio.google.com/app/apikey")
    sys.exit(1)
else:
    print("⚠ WARNING: Unusual key format")
    print(f"  Key starts with: {api_key[:10]}")
    print("  Expected: AIzaSy...")

# Check 3: Import google.generativeai
print("\n[3/6] Checking google-generativeai library...")
try:
    import google.generativeai as genai
    print("✓ Library imported successfully")
except ImportError:
    print("❌ FAILED: google-generativeai not installed")
    print("\n   Fix: Run in backend directory:")
    print("   pip install google-generativeai")
    sys.exit(1)

# Check 4: Configure API
print("\n[4/6] Configuring Gemini API...")
try:
    genai.configure(api_key=api_key)
    print("✓ API configured")
except Exception as e:
    print(f"❌ FAILED: {e}")
    sys.exit(1)

# Check 5: List available models
print("\n[5/6] Checking available models...")
try:
    models = genai.list_models()
    available_models = [m.name for m in models if 'generateContent' in m.supported_generation_methods]

    if available_models:
        print(f"✓ Found {len(available_models)} available models:")
        for model_name in available_models[:5]:
            print(f"  - {model_name}")
    else:
        print("⚠ WARNING: No models found")
        print("   This might mean the API is not enabled")

except Exception as e:
    print(f"❌ FAILED to list models: {e}")
    print("\n   This usually means:")
    print("   1. API key is invalid")
    print("   2. Generative Language API not enabled")
    print("\n   Fix:")
    print("   1. Enable API at:")
    print("      https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com")
    print("   2. Select the project your API key belongs to")
    print("   3. Click ENABLE")
    print("   4. Wait 2-3 minutes and try again")
    sys.exit(1)

# Check 6: Test actual generation
print("\n[6/6] Testing content generation...")
try:
    model = genai.GenerativeModel("gemini-1.5-flash")
    response = model.generate_content("Say 'Test successful'")

    print("✓ Content generation works!")
    print(f"  Response: {response.text}")

except Exception as e:
    error_str = str(e)
    print(f"❌ FAILED: {error_str}")

    if "401" in error_str or "Unauthorized" in error_str:
        print("\n   ERROR: 401 Unauthorized")
        print("   This means:")
        print("   1. The API key is invalid or expired")
        print("   2. The API key doesn't have permission for this API")
        print("\n   Fix:")
        print("   1. Create a NEW API key at:")
        print("      https://aistudio.google.com/app/apikey")
        print("   2. Make sure you create an 'Auth' key (not Standard)")
        print("   3. Replace key in backend/.env")
        print("   4. Restart this script")

    elif "403" in error_str or "Forbidden" in error_str:
        print("\n   ERROR: 403 Forbidden")
        print("   This means:")
        print("   1. The Generative Language API is not enabled")
        print("   2. Or the API key's project doesn't have access")
        print("\n   Fix:")
        print("   1. Enable API at:")
        print("      https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com")
        print("   2. Select your project")
        print("   3. Click ENABLE")
        print("   4. Wait 2-3 minutes")

    elif "429" in error_str or "quota" in error_str.lower():
        print("\n   ERROR: Quota exceeded")
        print("   You've hit the free tier limit")
        print("\n   Fix:")
        print("   1. Check usage at:")
        print("      https://console.cloud.google.com/apis/dashboard")
        print("   2. Wait for quota reset (daily/monthly)")
        print("   3. Or upgrade to paid tier")

    elif "404" in error_str or "not found" in error_str.lower():
        print("\n   ERROR: Model not found")
        print("   The API might not be properly enabled")
        print("\n   Fix:")
        print("   1. Enable API at:")
        print("      https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com")

    else:
        print("\n   Unknown error. Full message:")
        print(f"   {error_str}")

    sys.exit(1)

# Check 7: Test with image (base64)
print("\n[BONUS] Testing image analysis capability...")
try:
    # Create a tiny 1x1 red pixel PNG as base64
    test_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="

    response = model.generate_content([
        {
            "mime_type": "image/png",
            "data": test_image_base64
        },
        "Describe this image in 5 words"
    ])

    print("✓ Image analysis works!")
    print(f"  Response: {response.text[:100]}")

except Exception as e:
    print(f"⚠ Image test failed: {e}")
    print("  (Text generation works though, so basic API is OK)")

# Summary
print("\n" + "=" * 70)
print("DIAGNOSTIC SUMMARY")
print("=" * 70)
print("\n✅ ALL CHECKS PASSED!")
print("\nYour Gemini API is ready to use for pest identification.")
print("\nNext steps:")
print("1. Start backend: uvicorn main:app --reload")
print("2. Start frontend: npm run dev")
print("3. Login as farmer")
print("4. Go to Pest Monitoring")
print("5. Upload a pest image")
print("\nIf pest identification still fails:")
print("- Make sure backend server was restarted after updating .env")
print("- Check backend logs for errors")
print("- Try uploading a clear pest image (not too large)")
print("=" * 70)
