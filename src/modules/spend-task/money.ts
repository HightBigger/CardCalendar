export function minor(value:string):bigint {
 const [integer,fraction='']=value.split('.');
 return BigInt(integer)*100n+BigInt(fraction.padEnd(2,'0'));
}
export function money(value:bigint):string { return `${value/100n}.${(value%100n).toString().padStart(2,'0')}`; }
export function positiveDifference(target:string,current:string):string {
 const difference=minor(target)-minor(current);
 return money(difference>0n?difference:0n);
}
