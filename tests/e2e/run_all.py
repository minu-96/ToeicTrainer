"""tests/e2e 의 test_*.py 를 차례로 실행해요. 먼저 다른 창에서 npm run serve"""
import glob, os, subprocess, sys

here = os.path.dirname(os.path.abspath(__file__))
failed = []
for f in sorted(glob.glob(os.path.join(here, "test_*.py"))):
    print("▶", os.path.basename(f))
    if subprocess.run([sys.executable, f], cwd=here).returncode:
        failed.append(os.path.basename(f))
print("실패:", failed if failed else "없음")
sys.exit(1 if failed else 0)
