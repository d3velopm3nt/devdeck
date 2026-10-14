// Compatibility adapter; rendering and appearance live in the shared engine.
function mountVoiceOrb(canvas,isVisible,mode,audioLevel=()=>0){
  return DevOrb.mount(canvas,isVisible,mode,audioLevel,()=>snapshot.orb_preferences||DevOrb.defaults);
}
