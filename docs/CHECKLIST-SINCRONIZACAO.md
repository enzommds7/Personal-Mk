# Checklist de integridade e sincronização

Este documento descreve validações manuais antes de alterar a lógica de sincronização da agenda.

## Proteção dos dados

- Exporte um backup JSON de cada dispositivo antes de testar.
- **Nunca** adicione backups, anotações pessoais, credenciais ou capturas privadas ao repositório.
- Não limpe localStorage, dados do PWA nem desinstale o aplicativo durante a validação.
- Mudanças de sincronização devem ser testadas em ambiente isolado antes de serem publicadas.

## Cenários de regressão

1. Criar e editar uma nota no PC; conferir conteúdo e título no celular após sincronizar.
2. Editar no celular; conferir a alteração no PC.
3. Editar offline, fechar e reabrir; confirmar persistência local.
4. Reconectar após edição offline; conferir que a versão editada não desapareceu.
5. Editar a mesma data em dois dispositivos; preservar ambas as versões em caso de conflito.
6. Excluir offline e reconectar; verificar que a nota não reaparece.
7. Simular erro de permissão no Firestore; não exibir confirmação falsa de sincronização.
8. Simular falha de quota do armazenamento local; mostrar erro e preservar opção de backup.
9. Atualizar PWA com cache antigo; verificar atualização dos recursos.
10. Restaurar um backup de teste; conferir datas, títulos, conteúdo, tags e imagens.

## Critério de publicação

Não considerar a sincronização corrigida apenas porque o código foi enviado ao GitHub. É necessária validação real entre dispositivos e conferência do backup. Até lá, alterações funcionais arriscadas devem ser isoladas e revisadas.
