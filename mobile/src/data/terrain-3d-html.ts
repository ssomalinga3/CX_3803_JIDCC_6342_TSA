import { getBasemap, DEFAULT_BASEMAP } from '@/data/basemaps';
import { initialTerrainView, type TerrainViewState, type terrainTrails } from '@/data/terrain-3d';

function scriptJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function terrainDocument(
  trails: ReturnType<typeof terrainTrails>['collection'],
  session: string,
  view: TerrainViewState = initialTerrainView,
  basemapId: string = DEFAULT_BASEMAP,
  disposeWhenHidden: boolean = false,
) {
  // Keep the multi-megabyte payload modules unevaluated during ordinary 2D use.
  // Native focus/AppState gates this call and owns the WebView's lifetime.
  const elevation = require('../../assets/terrain-3d/elevation.json');
  const renderer = require('../../assets/terrain-3d/renderer.json');
  const basemap = getBasemap(basemapId);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob: https://tiles.openfreemap.org https://basemap.nationalmap.gov; worker-src blob:; connect-src data: blob: https://tiles.openfreemap.org https://basemap.nationalmap.gov">
<style>${renderer.css.replace(/<\/style/gi, '<\\/style')}
html,body,#map{margin:0;width:100%;height:100%;background:#e4ebef;overflow:hidden}
.maplibregl-ctrl-attrib{display:none}button{min-width:44px;min-height:44px}
</style></head><body><div id="map" role="img" aria-label="3D preserve terrain and trails. Drag to pan. Pinch to zoom. Use two fingers to rotate and tilt."></div>
<script>${renderer.js.replace(/<\/script/gi, '<\\/script')}</script>
<script>
(function(){
  'use strict';
  const elevation=${scriptJson(elevation)}, trails=${scriptJson(trails)}, session=${scriptJson(session)};
  const basemapStyle=${scriptJson(basemap.style)};
  const started=performance.now();
  let map, disposed=false, ready=false, remoteApplied=false, tilesFailed=false, tilesReady=false, loadGeneration=0, currentPosition=null;
  let styleController, tileTimeout;
  const send=(type,extra)=>{if(!disposed && window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({version:1,session,type,...extra}));};
  const fail=(code)=>{send('error',{code});dispose();};
  window.onerror=()=>{fail('render');return true;};
  function dispose(){if(disposed)return;disposed=true;clearTimeout(tileTimeout);styleController?.abort();if(map){map.remove();map=null;}maplibregl.removeProtocol('cascade-dem');maplibregl.clearPrewarmedResources();}
  window.addEventListener('pagehide',dispose);
  // Android may defer React's native unmount until resume. Release WebGL and
  // workers immediately. iOS uses native focus/AppState because WKWebView can
  // report transient hidden visibility during an active navigation transition.
  if(${disposeWhenHidden})document.addEventListener('visibilitychange',()=>{if(document.hidden)dispose();});
  try{
    maplibregl.setWorkerCount(1);
    maplibregl.addProtocol('cascade-dem',async(request)=>{
      const key=request.url.replace('cascade-dem://','').replace('.png','');
      const uri=elevation.tiles[key];
      if(!uri)throw new Error('Unbundled DEM tile');
      const raw=atob(uri.split(',')[1]), bytes=new Uint8Array(raw.length);
      for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      return {data:bytes.buffer};
    });
    const b=elevation.bounds;
    const initial=${scriptJson(view)};
    const line=(id,paint,filter)=>({id,type:'line',source:'trails',layout:{'line-cap':'round','line-join':'round'},paint,...(filter?{filter}:{})});
    const hillshade={id:'terrain-hillshade',type:'hillshade',source:'hillshade',paint:{
      'hillshade-illumination-anchor':'map','hillshade-illumination-direction':315,
      'hillshade-exaggeration':0.55,'hillshade-shadow-color':'#263c2b',
      'hillshade-highlight-color':'#fff3d6','hillshade-accent-color':'#53604a'
    }};
    const bundled={version:8,sources:{
        dem:{type:'raster-dem',tiles:['cascade-dem://{z}/{x}/{y}.png'],tileSize:elevation.tileSize,minzoom:elevation.minZoom??elevation.zoom,maxzoom:elevation.zoom,bounds:b,encoding:'mapbox'},
        hillshade:{type:'raster-dem',tiles:['cascade-dem://{z}/{x}/{y}.png'],tileSize:elevation.tileSize,minzoom:elevation.minZoom??elevation.zoom,maxzoom:elevation.zoom,bounds:b,encoding:'mapbox'},
        surface:{type:'image',url:elevation.surface,coordinates:elevation.coordinates},
        trails:{type:'geojson',data:trails},
        position:{type:'geojson',data:{type:'FeatureCollection',features:[]}}
      },layers:[
        {id:'background',type:'background',paint:{'background-color':'#e4ebef'}},
        {id:'surface',type:'raster',source:'surface',paint:{'raster-fade-duration':0,'raster-resampling':'linear'}},
        line('trail-casing',{'line-color':['get','_display_trail_casing'],'line-width':6}),
        line('trail-solid',{'line-color':['get','_display_trail_color'],'line-width':3.5},['==',['get','_display_trail_dashed'],false]),
        line('trail-dashed',{'line-color':['get','_display_trail_color'],'line-width':3.5,'line-dasharray':[2,2]},['==',['get','_display_trail_dashed'],true]),
        {id:'device-position',type:'circle',source:'position',paint:{'circle-radius':9,'circle-color':'#007aff','circle-stroke-color':'#fff','circle-stroke-width':3}}
      ],terrain:{source:'dem',exaggeration:1}};
    map=new maplibregl.Map({container:'map',...initial,minZoom:14,maxZoom:19,maxPitch:75,maxBounds:[[b[0],b[1]],[b[2],b[3]]],
      canvasContextAttributes:{antialias:false,preserveDrawingBuffer:false},pixelRatio:Math.min(devicePixelRatio,2),
      attributionControl:false,renderWorldCopies:false,maxTileCacheSize:96,fadeDuration:0,
      style:bundled
    });
    const tileFailure=()=>{
      if(disposed||tilesFailed)return;
      tilesFailed=true;remoteApplied=false;styleController?.abort();clearTimeout(tileTimeout);
      // Remove the failed provider's sources so requests stop until explicit retry.
      map.setStyle(bundled,{diff:false});send('tiles',{status:'unavailable'});
    };
    const setPosition=(coords)=>{
      currentPosition=coords;
      if(!map||!map.getSource('position'))return;
      const valid=Array.isArray(coords)&&coords.length===2&&coords.every(Number.isFinite)&&coords[0]>=b[0]&&coords[0]<=b[2]&&coords[1]>=b[1]&&coords[1]<=b[3];
      map.getSource('position').setData({type:'FeatureCollection',features:valid?[{type:'Feature',geometry:{type:'Point',coordinates:coords},properties:{}}]:[]});
    };
    map.on('style.load',()=>setPosition(currentPosition));
    async function loadBasemap(){
      const generation=++loadGeneration;
      styleController?.abort();styleController=new AbortController();
      tilesFailed=false;tilesReady=false;send('tiles',{status:'loading'});
      clearTimeout(tileTimeout);tileTimeout=setTimeout(()=>{if(!disposed&&generation===loadGeneration)tileFailure();},12000);
      try{
        let style=basemapStyle;
        if(typeof style==='string'){
          const url=new URL(style);
          if(url.protocol!=='https:'||!['tiles.openfreemap.org','basemap.nationalmap.gov'].includes(url.hostname))throw new Error('Unsupported tile origin');
          const response=await fetch(style,{signal:styleController.signal});
          if(!response.ok)throw new Error('Map style unavailable');
          const text=await response.text();
          if(text.length>2000000)throw new Error('Map style budget exceeded');
          style=JSON.parse(text);
        }
        if(disposed||generation!==loadGeneration)return;
        if(style.version!==8||!style.sources||!Array.isArray(style.layers)||Object.keys(bundled.sources).some((id)=>id in style.sources))throw new Error('Invalid map style');
        const background=style.layers.filter((layer)=>layer.type==='background');
        const ground=style.layers.filter((layer)=>!['background','fill-extrusion','symbol','hillshade'].includes(layer.type));
        const labels=style.layers.filter((layer)=>layer.type==='symbol');
        remoteApplied=true;
        map.setStyle({...style,sources:{...style.sources,...bundled.sources},layers:[...background,bundled.layers[1],...ground,hillshade,...labels,...bundled.layers.slice(2)],terrain:bundled.terrain},{diff:false});
      }catch(_){if(!disposed&&generation===loadGeneration)tileFailure();}
    }
    map.touchZoomRotate.enableRotation();
    map.touchPitch.enable();
    map.on('error',(event)=>{
      if(remoteApplied&&!['dem','hillshade','trails','position','surface'].includes(event.sourceId))tileFailure();
      else fail('render');
    });
    map.on('webglcontextlost',()=>fail('unsupported'));
    map.on('movestart',(event)=>{if(event.originalEvent)send('gesture');});
    map.on('moveend',()=>{if(map)send('camera',{view:{center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()}});});
    map.on('idle',()=>{
      if(!disposed && !ready && map.isSourceLoaded('dem')){
        ready=true;
        const startupMs=Math.round(performance.now()-started);
        window.__cascade3dDiagnostics={startupMs,trailCount:trails.features.length,terrain:true};
        send('ready',{startupMs});
        void loadBasemap();
      }
      if(!disposed&&remoteApplied&&!tilesFailed&&!tilesReady&&map.isStyleLoaded()){
        tilesReady=true;clearTimeout(tileTimeout);
        if(map.getLayer('surface')&&map.getLayoutProperty('surface','visibility')!=='none')map.setLayoutProperty('surface','visibility','none');
        send('tiles',{status:'ready'});
      }
    });
    window.cascade3d={
      camera:(options)=>{if(map)map.easeTo(options);},
      tilt:()=>{if(map)map.easeTo({pitch:map.getPitch()>=70?45:map.getPitch()+15,duration:250});},
      position:setPosition,retryTiles:()=>void loadBasemap(),dispose};
  }catch(_){fail('unsupported');}
})();
</script></body></html>`;
}
