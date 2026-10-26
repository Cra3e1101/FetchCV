"""Trusted, content-free layout copied from the user's didi/main.tex.

Snapshot data never supplies TeX commands, packages, paths or macro definitions.
"""

PREAMBLE = r"""\documentclass[UTF8,a4paper,fontset=none]{ctexart}
\usepackage[left=1.27cm,right=1.27cm,top=0.2cm,bottom=0.35cm,noheadfoot]{geometry}
\usepackage{fontspec}
\usepackage{graphicx}
\usepackage{tikz}
\usepackage{tabularx}
\usepackage{array}
\usepackage{enumitem}
\usepackage{needspace}
\usepackage[hidelinks]{hyperref}
\IfFontExistsTF{Times New Roman}
  {\setmainfont{Times New Roman}}
  {\setmainfont{TeX Gyre Termes}}
\IfFontExistsTF{SimSun}
  {\setCJKmainfont[AutoFakeBold=2.2]{SimSun}}
  {\setCJKmainfont[AutoFakeBold=2.2]{FandolSong-Regular}}
\IfFontExistsTF{SimSun}
  {\setCJKfamilyfont{song}[AutoFakeBold=2.2]{SimSun}}
  {\setCJKfamilyfont{song}[AutoFakeBold=2.2]{FandolSong-Regular}}
\newcommand{\songti}{\CJKfamily{song}}
\newcommand{\entryfont}{\fontsize{10.8pt}{11.3pt}\selectfont}
\newcommand{\eduEntryFont}{\fontsize{10.4pt}{10.9pt}\selectfont}
\newlength{\resumeBaseLeading}
\setlength{\resumeBaseLeading}{14.40pt}
\newcommand{\resumeSpacing}[1][0pt]{%
  \fontsize{10.2pt}{\dimexpr\resumeBaseLeading+#1\relax}\selectfont}
\newcommand{\educationSpacing}{\resumeSpacing[-2.5pt]}
\newcommand{\contentSpacing}{\resumeSpacing[0.20pt]}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\setlength{\tabcolsep}{0pt}
\setlength{\emergencystretch}{1.5em}
\raggedbottom
\AtBeginDocument{\resumeSpacing}
\newcommand{\resumeSection}[2][0.8mm]{%
  \needspace{3\baselineskip}%
  \vspace{#1}%
  {\fontsize{14pt}{14pt}\selectfont\bfseries #2}\par
  \vspace{-4.6mm}\rule{\textwidth}{0.45pt}\par
  \vspace{-0.8mm}%
}
\newcommand{\tripleEntry}[4][0.60mm]{%
  \noindent\begin{tabularx}{\textwidth}{@{}>{\bfseries\entryfont}X >{\centering\arraybackslash\entryfont}p{0.30\textwidth} >{\raggedleft\arraybackslash\entryfont}p{0.30\textwidth}@{}}
    #2 & #3 & #4
  \end{tabularx}\par
  \vspace{#1}%
}
\newcommand{\projectEntry}[4][0.26]{%
  \needspace{5\baselineskip}%
  \noindent\begin{tabularx}{\textwidth}{@{}>{\bfseries\entryfont}p{\dimexpr0.84\textwidth-#1\textwidth\relax} >{\centering\arraybackslash\entryfont}p{#1\textwidth} >{\raggedleft\arraybackslash\entryfont}X@{}}
    #2 & \hspace{-60pt}#3 & #4
  \end{tabularx}\par
  \vspace{0.60mm}%
}
\newcommand{\singleEntry}[1]{\textbf{#1}\par\vspace{0.30mm}}
\newenvironment{resumeItems}{%
  \begin{itemize}[
    label=\raisebox{0.28ex}{\fontsize{7.5pt}{7.5pt}\selectfont\bfseries\textbullet},
    leftmargin=1.55em,
    labelsep=0.48em,
    itemsep=0.10mm,
    topsep=0.10mm,
    parsep=0pt,
    partopsep=0pt
  ]
  \songti
}{\end{itemize}\vspace{0.25mm}}
\newcommand{\keyitem}[2]{\item \textbf{#1}#2}
"""
