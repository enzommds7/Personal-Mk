Funcionalidades

Design Minimalista & Responsivo: Interface limpa com efeito *Liquid Glass*, paleta de cores neutras e transição suave entre Tema Claro e Escuro.
Sincronização em Tempo Real: Arquitetura serverless com Firebase Firestore. O que você digita no PC aparece instantaneamente no celular.
Modo Offline-First: Usa `IndexedDB` e `localStorage` para funcionar 100% sem internet. Sincroniza automaticamente quando a conexão voltar.
Galeria de Imagens Otimizada:Suporte a upload ilimitado de imagens com compressão nativa via Canvas no navegador (reduzindo fotos pesadas antes do upload).
Editor Rich Text:Formatação de texto (negrito, itálico, listas, blocos de código) nativa sem bibliotecas pesadas.
Sistema de Tags:Organização por hashtags automáticas (#trabalho, #ideias) com filtro de busca em tempo real.
Exportação e Backup:Exporte notas em `.txt` ou gere um arquivo `.json` com o backup completo de todos os dias.


Este projeto foi construído **sem o uso de frameworks pesados** para garantir o máximo de controle sobre o DOM e performance. Toda a aplicação reside em um modelo *Single-File Component* adaptado (um único `index.html` contendo estrutura, estilos e lógica).

- Frontend:HTML5, CSS3 (Variáveis, Flexbox/Grid, Backdrop-filter), Vanilla JavaScript (ES6+).
- Banco de Dados (Local):`IndexedDB` (para imagens base64 grandes) e `localStorage` (para dados estruturados leves).
- Backend as a Service (BaaS):Firebase Auth (Autenticação) e Firebase Firestore (Banco NoSQL em nuvem).
- Deploy:GitHub Pages 

Licença

Este projeto é para uso pessoal e estudo. Sinta-se à vontade para clonar e adaptar para o seu dia a dia!
