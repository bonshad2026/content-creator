import {Component,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
class Boundary extends Component<{children:ReactNode},{error:boolean}>{state={error:false};static getDerivedStateFromError(){return{error:true};}render(){return this.state.error?<main className="page-loading"><h1>صفحه کامل باز نشد</h1><p>پیش‌نویست محفوظ است. صفحه رو دوباره باز کن.</p><button className="button" onClick={()=>location.reload()}>بازکردن دوباره</button></main>:this.props.children;}}
createRoot(document.getElementById('app')!).render(<Boundary><App/></Boundary>);
