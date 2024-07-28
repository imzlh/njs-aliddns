/// <reference path="../type/index.d.ts" />

/**
 * AliDDNS njs interface
 * 
 * @version 1.1
 * @copyright izGroup
 * @license MIT
 */

interface DescribeDomainRecordsResult{
    Status: string | 'Enable',
    Type: 'A' | 'AAAA' | 'CNAME' | 'MX',
    Remark: string,
    TTL: number,
    RecordId: number,
    Priority: number,
    RR: string,
    DomainName: string,
    Weight: number,
    Value: string,
    Line: 'default' | string,
    Locked: boolean,
    CreateTimestamp: number,
    UpdateTimestamp: number
}

interface Config{
    accessKey: string,
    accessSec: string,
    domain: string,
    dprefix: string,
    dtype: 'AAAA' | 'A',
    ipapi: string
}

/**
 * 编码字符串，代替`encodeURL`
 * @param data 字符串数据
 * @returns 编码后的字符串
 */
const encode = (data: string) => (typeof data == 'string' ? data : new String(data)).replace(
    /[^a-zA-Z0-9-_.~]/g,
    (data) => '%' + data.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()
);

/**
 * 向AliAPI发送请求
 * @param param 请求对象
 * @param config 配置
 * @returns 返回的数据
 */
async function request(param: Record<string,any>, config: Config) {
    // 合并参数
    const DEFAULT = {
        'AccessKeyId': config.accessKey,
        'Format': 'JSON',
        'SignatureMethod': 'HMAC-SHA1',
        'SignatureNonce': Math.floor(Math.random() * 0xffffffff) .toString(36),
        'SignatureVersion': '1.0',
        'Timestamp': new Date().toISOString().replace(/\..+$/, 'Z'),
        'Version': '2015-01-09'
    } as Record<string,any>;
    for (const key in DEFAULT) {
        if(key in param) continue;
        param[key] = DEFAULT[key];
    }

    // 编码
    let tmp = '', query = '';
    const keys = Object.keys(param).sort();
    for (let i = 0 ; i < keys.length ; i ++)
        tmp += '&' + encode(keys[i]) + '=' + encode(param[keys[i]]),
        query +='&' + keys[i] + '=' + param[keys[i]] ;
    const key = await crypto.subtle.importKey('raw', 
            config.accessSec + '&',
            {
                "name": "HMAC",
                "hash": "SHA-1"
            },
            true,
            ['sign']
        ),
        _key = await crypto.subtle.sign("HMAC", key, 'GET&%2F&' + encode(tmp.substring(1))),
        sig = Buffer.from(_key).toString('base64');

    // 请求
    const res = await ngx.fetch(
        'http://alidns.aliyuncs.com/?' + 
        'Signature=' + encodeURIComponent(sig) + query
    ), res_json = await res.json() as Record<string,any>;

    if(!res.ok || 'Message' in res_json)
        throw ngx.log(ngx.ERR, 'AliDDNS RequestError:  E_' + res_json['Code'] + ': ' + res_json['Message'] + '\n URL:' + 'http://alidns.aliyuncs.com/?' + 
        'Signature=' + sig + query) ;
    
    return res_json;
}


/**
 * 匹配域名解析记录
 * @param config 配置
 * @returns 记录
 */
async function getRecord(config: Config): Promise<DescribeDomainRecordsResult> {
    const res = await request({
            'Action': 'DescribeDomainRecords',
            'DomainName': config.domain
        }, config),
        domains = res['DomainRecords']['Record'] as Array<DescribeDomainRecordsResult>;

    for (let i = 0; i < domains.length; i++)
        if (domains[i]['Type'] == config.dtype && config.dprefix == domains[i]['RR'])
            return domains[i];

    throw new TypeError('Domain not found');
}

/**
 * 创建解析记录
 * @param addr 地址
 * @param config 配置
 * @returns 
 */
async function createRecord(addr: string, config: Config) {
    await request({
        'Action': 'AddDomainRecord',
        'DomainName': config.domain,
        'RR': config.dprefix,
        'Type': config.dtype,
        'Value': addr,
        'TTL': '600',
    }, config);
    return ngx.log(ngx.INFO, 'AliDDNS: Create new record<+1>');
}

async function main(session: NginxPeriodicSession) {try{
    
    // 生成配置
    const config:Config = {
        'accessKey': session.variables.ddns_key as string,
        'accessSec': session.variables.ddns_sec as string,
        'domain': session.variables.ddns_domain as string,
        'dprefix': session.variables.ddns_prefix as string,
        'dtype': session.variables.ddns_type as any,
        'ipapi': session.variables.ddns_ipapi as any
    }, shared = session.variables.shared_zone;

    // 判断
    for (const key in config) if(!(config as any)[key]) throw new Error('Missing param ' + key);

    // 获取IP地址
    const ipaddr = await ngx.fetch(config.ipapi);
    if (!ipaddr.ok) return ngx.log(ngx.ERR, `AliDDNS Fatal: IPApi(${config.ipapi}) returns with ${ipaddr.status}`);
    const addr = await ipaddr.text();

    // 获取结果
    if(shared && (shared in ngx.shared)){
        const dat = ngx.shared[shared].get('ddns') as string;
        if(dat) var record = JSON.parse(dat) as DescribeDomainRecordsResult;
        else{
            var record = await getRecord(config);
            ngx.shared[shared].set('ddns', JSON.stringify(record));
            ngx.log(ngx.INFO, "GET Record succeed");
        }
    }else{
        ngx.log(ngx.WARN, "Zone " + shared + " not found.");
        var record = await getRecord(config);
    }

    // 比较当前IP
    if (addr == record.Value) {
        ngx.log(ngx.INFO, `AliDDNS: IP not changed (${addr})`);
    } else {
        // 更新
        await request({
            'Action': 'UpdateDomainRecord',
            'RR': config.dprefix,
            'RecordId': record.RecordId,
            'TTL': record.TTL,
            'Type': record.Type,
            'Value': addr,
            'Version': '2015-01-09'
        }, config);

        // 更新缓存
        record['UpdateTimestamp'] = Date.now();
        record['Value'] = addr;
        shared && shared in ngx.shared && ngx.shared[shared].set('ddns', JSON.stringify(record));

        ngx.log(ngx.INFO, `AliDDNS: ${config.dprefix}.${config.domain} Redirected to ${addr}`);
    }
}catch(e){ ngx.log(ngx.ERR, "Thread DDNS exit abnormally.More: " + new String(e)); }}

async function status(h: NginxHTTPRequest) {
    h.headersOut['Content-Type'] = 'text/plain';
    if(!h.variables.shared_zone)
        return h.return(500, '$shared_zone not defined.Please reconfigure nginx with `js_set`');
    if(!(h.variables.shared_zone in ngx.shared))
        return h.return(500, 'SharedZone ' + h.variables.shared_zone + ' not found');
    const shared = ngx.shared[h.variables.shared_zone].get('ddns');
    if(typeof shared != 'string' || shared.length < 8) return h.return(500, 'Shared data not found');

    const data = JSON.parse(shared) as DescribeDomainRecordsResult,
        result = `这是域名的解析记录，请不要外泄: 
${data.RR}.${data.DomainName} (ID: ${data.RecordId}) => ${data.Value}
于 ${new Date(data.UpdateTimestamp).toISOString()} 更新</p>
解析类型: ${data.Type} TTL: ${data.TTL} 线路: ${data.Line}`;

    h.return(200, result);
}

export default { main, status };