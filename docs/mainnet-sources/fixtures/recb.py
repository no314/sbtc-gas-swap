import json,sys
open('balances.jsonl','a').write(json.dumps({'path':sys.argv[1],'raw':sys.argv[2]})+'\n')
