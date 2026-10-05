import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const js=ts.transpileModule(readFileSync(new URL('../src/fundingBalanceDisplay.ts',import.meta.url),'utf8'),
  {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {fundingBalanceForDisplay:display}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
for(const rate of [1,120,2309.58]){
  const currency=rate===1?'USD':'LCU';
  const threshold=10000*rate/1e9;
  for(const sign of [-1,1]){
    assert.equal(display(sign*threshold*.999,currency,rate),0);
    assert.equal(display(sign*threshold,currency,rate),sign*threshold);
    assert.equal(display(sign*threshold*1.001,currency,rate),sign*threshold*1.001);
  }
  assert.equal(display(0,currency,rate),0);
  assert.ok(!Object.is(display(-0,currency,rate),-0));
}
assert.equal(display(.000005,'USD',null),0);
assert.equal(display(-1e-20,'usd',null),0);
for(const rate of [null,0,-1,NaN,Infinity])assert.equal(display(.001,'CDF',rate),.001);
assert.equal(display(null,'USD',1),null);
assert.ok(Number.isNaN(display(NaN,'USD',1)));
assert.equal(display(Infinity,'USD',1),Infinity);
console.log('Funding balance display passed: strict US$10,000 boundary, both signs, native-currency equivalents, neutral zero, missing rates and null values.');
