import React from 'react';

interface PulseVisualizerProps {
  active: boolean;
  volume: number; // 0 to 1
}

const PulseVisualizer: React.FC<PulseVisualizerProps> = ({ active, volume }) => {
  // Scale volume for visual effect
  const scale = active ? 1 + volume * 2 : 1;
  
  return (
    <div className="relative flex items-center justify-center w-64 h-64">
      {/* Outer Glow Rings */}
      <div 
        className="absolute w-full h-full rounded-full border-4 border-blue-500 opacity-30 animate-ping"
        style={{ animationDuration: '3s' }}
      ></div>
      <div 
        className="absolute w-48 h-48 rounded-full border-2 border-blue-400 opacity-50 animate-ping"
        style={{ animationDuration: '2s', animationDelay: '0.5s' }}
      ></div>
      
      {/* Core Sonic Orb */}
      <div 
        className="relative z-10 w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 via-blue-600 to-blue-800 shadow-[0_0_50px_#3b82f6] flex items-center justify-center border-4 border-yellow-400 transition-transform duration-75"
        style={{ transform: `scale(${scale})` }}
      >
        <i className="fas fa-bolt text-5xl text-yellow-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"></i>
      </div>

      {/* Speed Lines Particles (Simulated with CSS) */}
      {active && (
         <>
             <div className="absolute w-full h-1 bg-blue-500 top-1/2 left-0 -translate-x-full animate-[slide_1s_infinite]"></div>
         </>
      )}
    </div>
  );
};

export default PulseVisualizer;
