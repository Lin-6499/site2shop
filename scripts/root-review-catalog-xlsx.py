import zipfile, xml.etree.ElementTree as E, json, hashlib, pathlib, sys
base=pathlib.Path(sys.argv[1]); plan_path=pathlib.Path(sys.argv[2]); plan=json.loads(plan_path.read_text(encoding='utf-8-sig')); ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def cells(file):
    with zipfile.ZipFile(file) as z:
        ss=[''.join(x.itertext()) for x in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)] if 'xl/sharedStrings.xml' in z.namelist() else []
        out={}
        for c in E.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:sheetData/s:row/s:c',ns):
            assert c.find('s:f',ns) is None, 'Unexpected workbook formula'
            v=c.find('s:v',ns); x=v.text if v is not None else None
            if c.get('t')=='s': x=ss[int(x)]
            if c.get('t')=='inlineStr': x=''.join(c.find('s:is',ns).itertext())
            out[c.get('r')]=x
        return out
w=pathlib.Path(plan['workbook']['file']); orig=cells(base/'products_import_template.original.xlsx'); now=cells(w); cols=[chr(65+i) for i in range(26)]+['A'+chr(65+i) for i in range(8)]
assert hashlib.sha256(w.read_bytes()).hexdigest()==plan['workbook']['sha256']
assert all(orig.get(f'{c}{r}')==now.get(f'{c}{r}') for c in cols for r in [1,2])
for i,row in enumerate(plan['rows'],3):
    assert len(row)==34
    for c,ex in zip(cols,row):
        a=now.get(f'{c}{i}'); assert (a in [None,''] if ex is None else str(ex)==a),(c,i,ex,a)
assert not [(k,v) for k,v in now.items() if int(''.join(filter(str.isdigit,k)))>len(plan['rows'])+2 and v not in [None,'']]
print(json.dumps({'planSha256':hashlib.sha256(plan_path.read_bytes()).hexdigest(),'workbookSha256':plan['workbook']['sha256'],'headersAndRulesExact':True,'dataCellsEqualPlan':34*len(plan['rows']),'noExtraDataOrFormulas':True}))
