import json,sys,os
# usage: rec.py <contract_id> <var> <raw_json_text>
p='datavars.jsonl'
open(p,'a').write(json.dumps({'contract':sys.argv[1],'var':sys.argv[2],'raw':sys.argv[3]})+'\n')
