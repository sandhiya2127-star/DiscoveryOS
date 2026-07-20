import py_compile

try:
    py_compile.compile('main.py', doraise=True)
    print('compiled OK')
except Exception as e:
    import traceback
    traceback.print_exc()