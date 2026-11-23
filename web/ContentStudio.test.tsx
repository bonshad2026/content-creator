import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {expect,it,vi,afterEach} from 'vitest';
import {Wizard,ContentStudio,searchTemplates} from './ContentStudio';
const mock=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),api:mock.api}));
const catalog={platforms:[{id:'instagram',name:'اینستاگرام',enabled:true},{id:'telegram',name:'تلگرام',enabled:false}],categories:[{id:'beauty',name:'آرایشی‌بهداشتی',subcategories:[{id:'skincare',name:'مراقبت پوست'}]},{id:'jewelry',name:'زیورآلات',subcategories:[{id:'bracelets',name:'دستبند'}]}],goals:[{id:'introduce',name:'معرفی محصول'}],imageTemplates:[{id:'blue-splash',name:'اسپلش آبی',sample:'/sample.webp',category:'beauty',subcategories:['skincare'],platforms:['instagram'],tags:['آب','skincare'],goals:['introduce'],inputs:{maxProducts:1},formats:[{id:'portrait',label:'پست عمودی · ۴:۵'}]},{id:'wrist',name:'روی مچ',sample:'/wrist.webp',category:'jewelry',subcategories:['bracelets'],platforms:['instagram'],tags:['طلایی','دستبند','bracelet'],goals:['introduce'],inputs:{maxProducts:3},formats:[{id:'portrait',label:'پست عمودی · ۴:۵'}]}],captionTemplates:[{id:'short-intro',name:'معرفی کوتاه'}]};
afterEach(()=>{cleanup();vi.clearAllMocks();location.hash='';});
it('opens template grid directly after platform, then asks the goal',async()=>{
 const create=vi.fn().mockResolvedValue(undefined);render(<Wizard catalog={catalog} onCreate={create}/>);
 expect((screen.getByRole('button',{name:'تلگرام'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'اینستاگرام'}));expect(screen.getByRole('searchbox',{name:'جست‌وجوی قالب'})).toBeTruthy();expect(screen.queryByRole('button',{name:'آرایشی‌بهداشتی'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/اسپلش آبی/}));expect(screen.getByRole('heading',{name:'هدف این محتوا چیست؟'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'معرفی محصول'}));fireEvent.click(screen.getByRole('button',{name:/^ادامه$/}));fireEvent.click(screen.getByRole('button',{name:'معرفی کوتاه'}));fireEvent.click(screen.getByRole('button',{name:'پست عمودی · ۴:۵'}));
 const button=screen.getByRole('button',{name:'ادامه با این قالب'});expect(button.closest('.cc-wizard-body')).toBeNull();fireEvent.click(button);
 await waitFor(()=>expect(create).toHaveBeenCalledWith({platform:'instagram',imageTemplate:'blue-splash',goal:'introduce',captionTemplate:'short-intro',format:'portrait'}));
});
it('searches names and tags with Persian/Arabic spelling normalization',()=>{
 expect(searchTemplates(catalog,'instagram','طلايی').map(t=>t.id)).toEqual(['wrist']);expect(searchTemplates(catalog,'instagram','دست‌بند').map(t=>t.id)).toEqual(['wrist']);expect(searchTemplates(catalog,'instagram','BRACELET').map(t=>t.id)).toEqual(['wrist']);
 render(<Wizard catalog={catalog} onCreate={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'اینستاگرام'}));fireEvent.change(screen.getByRole('searchbox',{name:'جست‌وجوی قالب'}),{target:{value:'طلایی'}});expect(screen.queryByRole('button',{name:/اسپلش آبی/})).toBeNull();expect(screen.getByRole('button',{name:/روی مچ/})).toBeTruthy();
});
it('shows an explicit next action after an uploaded photo',async()=>{
 location.hash='#/content/test-draft';const edit={id:'test-draft',templateId:'blue-splash',name:'اسپلش آبی',status:'awaiting',stage:null,createdAt:Date.now(),completed:false,locked:false,brief:'',fields:{},fieldDefinitions:[],hasPhoto:true,photo:'/api/content/test-draft/photo?v=p',question:null,result:null};
 mock.api.mockImplementation(async(path:string)=>path==='/api/content/catalog'?catalog:path==='/api/content'?[]:edit);render(<ContentStudio user={{name:'تست',phone:'09120000000'}} onLogout={vi.fn()}/>);
 expect(await screen.findByText('عکس رسید؛ برای ادامه «بررسی عکس» را بزن.')).toBeTruthy();expect((screen.getByRole('button',{name:'بررسی عکس'}) as HTMLButtonElement).disabled).toBe(false);
});
