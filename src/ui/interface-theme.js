const KEY="fetchcv.interface-theme";
export function readInterfaceTheme(){try{const value=localStorage.getItem(KEY);return ["white","neutral-dark","light","dark"].includes(value)?value:"white"}catch{return "white"}}
export function applyInterfaceTheme(value=readInterfaceTheme()){
 const theme=["white","neutral-dark","light","dark"].includes(value)?value:"white";
 document.documentElement.dataset.interfaceTheme=theme;
 document.documentElement.dataset.colorScheme=["dark","neutral-dark"].includes(theme)?"dark":"light";
 return theme;
}
export function saveInterfaceTheme(value){const theme=applyInterfaceTheme(value);try{localStorage.setItem(KEY,theme)}catch{/* The selected appearance still works for this session. */}return theme}
